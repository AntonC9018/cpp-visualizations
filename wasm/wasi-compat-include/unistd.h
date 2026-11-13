#pragma once
#include_next <unistd.h>
#ifndef _SC_GETPW_R_SIZE_MAX
#define _SC_GETPW_R_SIZE_MAX 70
#endif
static inline int getsid(int) { return 0; }
static inline int setsid(void) { return 0; }
static inline int dup2(int, int) { return -1; }
static inline int fork(void) { return -1; }
static inline int execv(const char *, char *const[]) { return -1; }
static inline int execve(const char *, char *const[], char *const[]) { return -1; }
static inline unsigned int alarm(unsigned int) { return 0; }
static inline int pipe(int[2]) { return -1; }
static inline unsigned int getuid(void) { return 0; }
static inline int fchown(int, unsigned int, unsigned int) { return 0; }
