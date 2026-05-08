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
find_package(PkgConfig REQUIRED)
pkg_check_modules(PipeWire REQUIRED libpipewire-0.3)

add_library(wal_qt_lib STATIC)
target_include_directories(wal_qt_lib PUBLIC src ${PipeWire_INCLUDE_DIRS})
target_link_libraries(wal_qt_lib PUBLIC
    Qt6::Core Qt6::Gui Qt6::Widgets
    Qt6::WebEngineWidgets Qt6::WebChannel Qt6::Network
    LayerShellQt::Interface
    ${PipeWire_LIBRARIES})

add_subdirectory(src)

add_executable(wal-qt src/main.cpp)
target_link_libraries(wal-qt PRIVATE wal_qt_lib)

set(RENDERER_DIST ${CMAKE_SOURCE_DIR}/renderer/dist)
set(RENDERER_QRC  ${CMAKE_BINARY_DIR}/renderer.qrc)

add_custom_command(
    OUTPUT  ${RENDERER_QRC}
    COMMAND ${CMAKE_SOURCE_DIR}/scripts/gen-renderer-qrc.sh ${RENDERER_DIST} ${RENDERER_QRC}
    DEPENDS ${RENDERER_DIST}/index.html
    COMMENT "Generating renderer.qrc from ${RENDERER_DIST}"
)
add_custom_target(renderer_qrc DEPENDS ${RENDERER_QRC})

set_source_files_properties(${RENDERER_QRC} PROPERTIES GENERATED 1)
target_sources(wal-qt PRIVATE ${RENDERER_QRC})
add_dependencies(wal-qt renderer_qrc)

if(WAL_QT_BUILD_TESTS)
    enable_testing()
    add_subdirectory(tests)
endif()
