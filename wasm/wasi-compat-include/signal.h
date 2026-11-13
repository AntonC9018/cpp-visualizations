#pragma once
#define _WASI_EMULATED_SIGNAL 1
#include_next <signal.h>
#include <__typedef_sigset_t.h>
#ifndef SIGBUS
#define SIGBUS 7
#endif
#ifndef SIGTRAP
#define SIGTRAP 5
#endif
#ifndef SIGPIPE
#define SIGPIPE 13
#endif
#ifndef SIGKILL
#define SIGKILL 9
#endif
#ifndef SIGQUIT
#define SIGQUIT 3
#endif
#ifndef SIGHUP
#define SIGHUP 1
#endif
#ifndef SIGINT
#define SIGINT 2
#endif
#ifndef SIGTERM
#define SIGTERM 15
#endif
#ifndef SIGUSR1
#define SIGUSR1 10
#endif
#ifndef SIGUSR2
#define SIGUSR2 12
#endif
#ifndef SIGINFO
#define SIGINFO 29
#endif
#ifndef SIG_UNBLOCK
#define SIG_UNBLOCK 1
#endif
#ifndef SIG_BLOCK
#define SIG_BLOCK 0
#endif
#ifndef SIG_SETMASK
#define SIG_SETMASK 2
#endif
#ifndef SA_SIGINFO
#define SA_SIGINFO 4
#endif
#ifndef SA_ONSTACK
#define SA_ONSTACK 0x08000000
#endif
#ifndef SA_RESETHAND
#define SA_RESETHAND 0x80000000
#endif
#ifndef SA_NODEFER
#define SA_NODEFER 0x40000000
#endif
typedef struct {
  int si_signo;
  int si_errno;
  int si_code;
  int si_pid;
} siginfo_t;
struct sigaction {
  union {
    void (*sa_handler)(int);
    void (*sa_sigaction)(int, siginfo_t *, void *);
  };
  sigset_t sa_mask;
  int sa_flags;
};
static inline int sigemptyset(sigset_t *s) { if (s) *s = 0; return 0; }
static inline int sigfillset(sigset_t *s) { if (s) *s = (sigset_t)~0U; return 0; }
static inline int sigaddset(sigset_t *s, int sig) { if (s) *s |= (sigset_t)(1U << (sig & 7)); return 0; }
static inline int sigprocmask(int, const sigset_t *, sigset_t *) { return 0; }
static inline int sigaction(int, const struct sigaction *, struct sigaction *) { return 0; }
static inline int kill(int, int) { return 0; }
