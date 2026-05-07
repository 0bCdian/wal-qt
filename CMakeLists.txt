cmake_minimum_required(VERSION 3.16)
project(wal-qt VERSION 0.1 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTORCC ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

option(WAL_QT_BUILD_TESTS "Build wal-qt unit tests" ON)

find_package(Qt6 REQUIRED COMPONENTS
    Core Gui Widgets WebEngineWidgets WebChannel Network Test)
find_package(LayerShellQt REQUIRED)

add_library(wal_qt_lib STATIC)
target_include_directories(wal_qt_lib PUBLIC src)
target_link_libraries(wal_qt_lib PUBLIC
    Qt6::Core Qt6::Gui Qt6::Widgets
    Qt6::WebEngineWidgets Qt6::WebChannel Qt6::Network
    LayerShellQt::Interface)

add_subdirectory(src)

add_executable(wal-qt src/main.cpp)
target_link_libraries(wal-qt PRIVATE wal_qt_lib)

if(WAL_QT_BUILD_TESTS)
    enable_testing()
    add_subdirectory(tests)
endif()
