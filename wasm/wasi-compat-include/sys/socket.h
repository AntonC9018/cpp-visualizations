#pragma once
#include_next <sys/socket.h>
static inline int socket(int, int, int) { return -1; }
static inline int connect(int, const struct sockaddr *, socklen_t) { return -1; }
static inline int bind(int, const struct sockaddr *, socklen_t) { return -1; }
static inline int listen(int, int) { return -1; }
