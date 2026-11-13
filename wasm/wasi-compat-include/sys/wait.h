#pragma once
#include <sys/types.h>
#include <sys/resource.h>
#define WNOHANG 1
#define WUNTRACED 2
#define WEXITSTATUS(s) (((s) & 0xff00) >> 8)
#define WTERMSIG(s) ((s) & 0x7f)
#define WIFEXITED(s) (WTERMSIG(s) == 0)
#define WIFSIGNALED(s) (((signed char) (((s) & 0x7f) + 1) >> 1) > 0)
static inline pid_t wait(int *status) { if (status) *status = 0; return -1; }
static inline pid_t waitpid(pid_t, int *status, int) { if (status) *status = 0; return -1; }
static inline pid_t wait4(pid_t, int *status, int, struct rusage *) { if (status) *status = 0; return -1; }
