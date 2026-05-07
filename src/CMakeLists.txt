target_sources(wal_qt_lib PRIVATE
    _placeholder.cpp
    # populated by later tasks
)

target_sources(wal_qt_lib PRIVATE
    util/socket_path.cpp
)

target_sources(wal_qt_lib PRIVATE
    util/mime.cpp
)

target_sources(wal_qt_lib PRIVATE
    http/http_parser.cpp
)

target_sources(wal_qt_lib PRIVATE
    http/http_server.h
    http/http_server.cpp
)

target_sources(wal_qt_lib PRIVATE
    wallpaper/target_resolver.cpp
)

target_sources(wal_qt_lib PRIVATE
    web/scheme_handler.h
    web/scheme_handler.cpp
)

target_sources(wal_qt_lib PRIVATE
    web/network_interceptor.h
    web/network_interceptor.cpp
)

target_sources(wal_qt_lib PRIVATE
    web/csp_injector.h
    web/csp_injector.cpp
)

target_sources(wal_qt_lib PRIVATE
    wallpaper/wallpaper_bridge.h
    wallpaper/wallpaper_bridge.cpp
)

target_sources(wal_qt_lib PRIVATE
    wallpaper/pending_load.cpp
)

target_sources(wal_qt_lib PRIVATE
    wallpaper/wallpaper_window.h
    wallpaper/wallpaper_window.cpp
)

target_sources(wal_qt_lib PRIVATE
    wallpaper/wallpaper_controller.h
    wallpaper/wallpaper_controller.cpp
)

target_sources(wal_qt_lib PRIVATE
    app/single_instance.cpp
)

target_sources(wal_qt_lib PRIVATE
    app/app.h
    app/app.cpp
)
