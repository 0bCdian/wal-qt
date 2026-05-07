function(walqt_add_test NAME)
    add_executable(${NAME} ${NAME}.cpp)
    target_link_libraries(${NAME} PRIVATE wal_qt_lib Qt6::Test)
    add_test(NAME ${NAME} COMMAND ${NAME})
endfunction()

walqt_add_test(test_socket_path)
walqt_add_test(test_mime)
