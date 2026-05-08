#include "audio/audio_capture.h"

#include <QMetaObject>
#include <QLoggingCategory>

#include <pipewire/pipewire.h>
#include <spa/param/audio/format-utils.h>

#include <cmath>
#include <complex>
#include <cstring>

namespace walqt {

// ---------------------------------------------------------------------------
// Minimal Cooley-Tukey radix-2 in-place FFT (power-of-2 sizes only).
// ---------------------------------------------------------------------------
static void fft(std::vector<std::complex<float>> &a)
{
    const int n = static_cast<int>(a.size());
    for (int i = 1, j = 0; i < n; ++i) {
        int bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) std::swap(a[i], a[j]);
    }
    for (int len = 2; len <= n; len <<= 1) {
        const float angle = -2.0f * static_cast<float>(M_PI) / len;
        const std::complex<float> wlen(std::cos(angle), std::sin(angle));
        for (int i = 0; i < n; i += len) {
            std::complex<float> w(1.0f, 0.0f);
            for (int j = 0; j < len / 2; ++j) {
                auto u = a[i + j];
                auto v = a[i + j + len / 2] * w;
                a[i + j]           = u + v;
                a[i + j + len / 2] = u - v;
                w *= wlen;
            }
        }
    }
}

// ---------------------------------------------------------------------------
// 128 log-spaced bands mapped from FFT magnitude bins.
// Frequency range: 20 Hz – 20 kHz (clamped to Nyquist).
// ---------------------------------------------------------------------------
QVector<float> AudioCapture::computeBands(const std::vector<float> &samples)
{
    const int n = AUDIO_FFT_SIZE;
    std::vector<std::complex<float>> cx(n);

    // Hann window + copy.
    for (int i = 0; i < n; ++i) {
        float w = 0.5f * (1.0f - std::cos(2.0f * static_cast<float>(M_PI) * i / (n - 1)));
        cx[i]   = {samples[i] * w, 0.0f};
    }
    fft(cx);

    // Magnitude spectrum (first n/2 bins are useful).
    const int halfN = n / 2;
    std::vector<float> mag(halfN);
    for (int i = 0; i < halfN; ++i)
        mag[i] = std::abs(cx[i]) / halfN;

    // Map to AUDIO_NUM_BANDS log-spaced bands.
    const double binHz   = static_cast<double>(AUDIO_SAMPLE_RATE) / n;
    const double fMin    = 20.0;
    const double fMax    = 20000.0;
    const double logMin  = std::log(fMin);
    const double logMax  = std::log(fMax);
    const double logStep = (logMax - logMin) / AUDIO_NUM_BANDS;

    QVector<float> bands(AUDIO_NUM_BANDS, 0.0f);
    for (int b = 0; b < AUDIO_NUM_BANDS; ++b) {
        double fl = std::exp(logMin + b       * logStep);
        double fh = std::exp(logMin + (b + 1) * logStep);
        int bl = std::max(1,         static_cast<int>(fl / binHz));
        int bh = std::min(halfN - 1, static_cast<int>(fh / binHz));
        float peak = 0.0f;
        for (int k = bl; k <= bh; ++k)
            if (mag[k] > peak) peak = mag[k];
        // Normalise: rough empirical headroom of 0.5 for typical content.
        bands[b] = std::min(1.0f, peak / 0.5f);
    }
    return bands;
}

// ---------------------------------------------------------------------------
// PipeWire stream process callback (PipeWire thread).
// ---------------------------------------------------------------------------
void AudioCapture::onProcess(void *userdata)
{
    auto *self = static_cast<AudioCapture*>(userdata);
    struct pw_buffer *buf = pw_stream_dequeue_buffer(self->stream_);
    if (!buf) return;

    struct spa_buffer *spa_buf = buf->buffer;
    if (!spa_buf->datas[0].data) {
        pw_stream_queue_buffer(self->stream_, buf);
        return;
    }

    const float *data   = static_cast<const float*>(spa_buf->datas[0].data);
    const int    nBytes = static_cast<int>(spa_buf->datas[0].chunk->size);
    const int    nFrames = nBytes / (sizeof(float) * self->channels_);

    for (int i = 0; i < nFrames; ++i) {
        float mono = 0.0f;
        for (int c = 0; c < self->channels_; ++c)
            mono += data[i * self->channels_ + c];
        mono /= self->channels_;
        self->pushSample(mono);
    }

    pw_stream_queue_buffer(self->stream_, buf);
}

void AudioCapture::pushSample(float s)
{
    sampleBuf_[samplePos_++] = s;
    if (samplePos_ >= AUDIO_FFT_SIZE) {
        processBatch();
        samplePos_ = 0;
    }
}

void AudioCapture::processBatch()
{
    QVector<float> bands = computeBands(sampleBuf_);

    // RMS and peak of the raw batch.
    float sumSq = 0.0f, peak = 0.0f;
    for (float s : sampleBuf_) {
        sumSq += s * s;
        float a = std::fabs(s);
        if (a > peak) peak = a;
    }
    float rms = std::sqrt(sumSq / AUDIO_FFT_SIZE);

    // Emit on the Qt main thread (this function runs on the PipeWire thread).
    QMetaObject::invokeMethod(this, [this, bands, rms, peak]() {
        emit audioFrame(bands, rms, peak);
    }, Qt::QueuedConnection);
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
AudioCapture::AudioCapture(QObject *parent)
    : QObject(parent)
    , sampleBuf_(AUDIO_FFT_SIZE, 0.0f)
{
    streamListener_ = new spa_hook{};
}

AudioCapture::~AudioCapture()
{
    stop();
    delete streamListener_;
}

void AudioCapture::start()
{
    if (running_.load()) return;

    pw_init(nullptr, nullptr);

    loop_    = pw_main_loop_new(nullptr);
    if (!loop_) { qWarning("AudioCapture: failed to create pw_main_loop"); return; }
    context_ = pw_context_new(pw_main_loop_get_loop(loop_), nullptr, 0);
    if (!context_) { qWarning("AudioCapture: failed to create pw_context"); pw_main_loop_destroy(loop_); loop_ = nullptr; return; }
    core_    = pw_context_connect(context_, nullptr, 0);
    if (!core_) { qWarning("AudioCapture: failed to connect to PipeWire (daemon running?)"); pw_context_destroy(context_); context_ = nullptr; pw_main_loop_destroy(loop_); loop_ = nullptr; return; }

    struct pw_properties *props = pw_properties_new(
        PW_KEY_MEDIA_TYPE,     "Audio",
        PW_KEY_MEDIA_CATEGORY, "Capture",
        PW_KEY_MEDIA_ROLE,     "Music",
        // Capture from the default sink monitor (loopback/what-you-hear).
        PW_KEY_STREAM_CAPTURE_SINK, "true",
        nullptr);

    stream_ = pw_stream_new(core_, "wal-qt-audio", props);
    if (!stream_) { qWarning("AudioCapture: failed to create pw_stream"); pw_core_disconnect(core_); core_ = nullptr; pw_context_destroy(context_); context_ = nullptr; pw_main_loop_destroy(loop_); loop_ = nullptr; return; }

    static const struct pw_stream_events stream_events = {
        .version = PW_VERSION_STREAM_EVENTS,
        .process = AudioCapture::onProcess,
    };
    pw_stream_add_listener(stream_, streamListener_, &stream_events, this);

    uint8_t buffer[1024];
    struct spa_pod_builder b = SPA_POD_BUILDER_INIT(buffer, sizeof(buffer));
    struct spa_audio_info_raw info{};
    info.format   = SPA_AUDIO_FORMAT_F32;
    info.rate     = AUDIO_SAMPLE_RATE;
    info.channels = 2;
    channels_ = 2;
    const struct spa_pod *params[1];
    params[0] = spa_format_audio_raw_build(&b, SPA_PARAM_EnumFormat, &info);

    const int err = pw_stream_connect(
        stream_,
        PW_DIRECTION_INPUT,
        PW_ID_ANY,
        static_cast<pw_stream_flags>(PW_STREAM_FLAG_AUTOCONNECT | PW_STREAM_FLAG_MAP_BUFFERS),
        params, 1);
    if (err < 0) {
        qWarning("AudioCapture: pw_stream_connect failed: %d", err);
        pw_stream_destroy(stream_); stream_ = nullptr;
        pw_core_disconnect(core_); core_ = nullptr;
        pw_context_destroy(context_); context_ = nullptr;
        pw_main_loop_destroy(loop_); loop_ = nullptr;
        return;
    }

    thread_ = std::thread([this]() {
        running_.store(true);
        pw_main_loop_run(loop_);
        running_.store(false);
    });
    qInfo("AudioCapture: started PipeWire monitor capture");
}

void AudioCapture::stop()
{
    if (!loop_) return;
    pw_main_loop_quit(loop_);
    if (thread_.joinable()) thread_.join();

    if (stream_)  { pw_stream_destroy(stream_);       stream_  = nullptr; }
    if (core_)    { pw_core_disconnect(core_);         core_    = nullptr; }
    if (context_) { pw_context_destroy(context_);      context_ = nullptr; }
    if (loop_)    { pw_main_loop_destroy(loop_);       loop_    = nullptr; }

    samplePos_ = 0;
    qInfo("AudioCapture: stopped");
}

} // namespace walqt
