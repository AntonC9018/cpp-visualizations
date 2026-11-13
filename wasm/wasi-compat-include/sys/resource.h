#pragma once
#include <sys/time.h>
#define RUSAGE_SELF 1
#define RUSAGE_CHILDREN 2
struct rusage {
  struct timeval ru_utime;
  struct timeval ru_stime;
  long ru_maxrss;
};
typedef unsigned long long rlim_t;
struct rlimit {
  rlim_t rlim_cur;
  rlim_t rlim_max;
};
#define RLIMIT_CPU 0
#define RLIMIT_FSIZE 1
#define RLIMIT_DATA 2
#define RLIMIT_STACK 3
#define RLIMIT_CORE 4
#define RLIMIT_RSS 5
#define RLIMIT_NPROC 6
#define RLIMIT_NOFILE 7
#define RLIMIT_MEMLOCK 8
#define RLIMIT_AS 9
#define RLIM_INFINITY (~0ULL)
static inline int getrlimit(int, struct rlimit *r) {
  if (r) { r->rlim_cur = RLIM_INFINITY; r->rlim_max = RLIM_INFINITY; }
  return 0;
}
static inline int setrlimit(int, const struct rlimit *) { return 0; }
static inline int getrusage(int, struct rusage *r) {
  if (r) {
    r->ru_utime.tv_sec = 0; r->ru_utime.tv_usec = 0;
    r->ru_stime.tv_sec = 0; r->ru_stime.tv_usec = 0;
    r->ru_maxrss = 0;
  }
  return 0;
}
