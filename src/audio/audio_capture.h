#pragma once
#include <QObject>
#include <QVector>
#include <atomic>
#include <thread>
#include <vector>

struct pw_main_loop;
struct pw_context;
struct pw_core;
struct pw_stream;
struct spa_hook;

namespace walqt {

static constexpr int AUDIO_SAMPLE_RATE = 44100;
static constexpr int AUDIO_FFT_SIZE    = 1024;
static constexpr int AUDIO_NUM_BANDS   = 128;

class AudioCapture : public QObject {
    Q_OBJECT
public:
    explicit AudioCapture(QObject *parent = nullptr);
    ~AudioCapture() override;

    void start();
    void stop();
    bool isRunning() const { return running_.load(); }

signals:
    void audioFrame(QVector<float> bands, float rms, float peak);

private:
    pw_main_loop *loop_    = nullptr;
    pw_context   *context_ = nullptr;
    pw_core      *core_    = nullptr;
    pw_stream    *stream_  = nullptr;
    spa_hook     *streamListener_ = nullptr;

    std::thread        thread_;
    std::atomic<bool>  running_{false};
    int                channels_ = 2;

    // Sample accumulation buffer for FFT (mono mix-down).
    std::vector<float> sampleBuf_;
    int                samplePos_ = 0;

    void pushSample(float s);
    void processBatch();
    QVector<float> computeBands(const std::vector<float> &samples);

    static void onProcess(void *userdata);
};

} // namespace walqt
