function(walqt_add_test NAME)
    add_executable(${NAME} ${NAME}.cpp)
    target_link_libraries(${NAME} PRIVATE wal_qt_lib Qt6::Test)
    add_test(NAME ${NAME} COMMAND ${NAME})
endfunction()

add_compile_definitions(WALQT_FIXTURES_DIR="${CMAKE_CURRENT_SOURCE_DIR}/fixtures")

walqt_add_test(test_socket_path)
walqt_add_test(test_mime)
walqt_add_test(test_http_parser)
walqt_add_test(test_target_resolver)
walqt_add_test(test_scheme_handler_paths)
walqt_add_test(test_network_interceptor)
