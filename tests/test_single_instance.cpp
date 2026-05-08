#include <QtTest/QtTest>
#include <QCoreApplication>
#include <QTemporaryDir>

#include "app/single_instance.h"

using namespace walqt;

class TestSingleInstance : public QObject {
    Q_OBJECT
private slots:
    void second_instance_fails_while_first_holds()
    {
        QTemporaryDir tmp;
        QVERIFY(tmp.isValid());
        qputenv("XDG_RUNTIME_DIR", tmp.path().toUtf8());

        SingleInstance first;
        QVERIFY(first.acquire());
        {
            SingleInstance second;
            QVERIFY(!second.acquire());
        }
    }

    void lock_released_after_first_destroys_so_third_acquires()
    {
        QTemporaryDir tmp;
        QVERIFY(tmp.isValid());
        qputenv("XDG_RUNTIME_DIR", tmp.path().toUtf8());

        {
            SingleInstance first;
            QVERIFY(first.acquire());
            {
                SingleInstance second;
                QVERIFY(!second.acquire());
            }
        }
        SingleInstance third;
        QVERIFY(third.acquire());
    }
};

QTEST_GUILESS_MAIN(TestSingleInstance)
#include "test_single_instance.moc"
