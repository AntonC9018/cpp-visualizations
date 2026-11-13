#pragma once
#include <stdlib.h>
typedef int jmp_buf[1];
typedef int sigjmp_buf[1];
static inline int setjmp(jmp_buf) { return 0; }
static inline void longjmp(jmp_buf, int) { abort(); }
static inline int sigsetjmp(sigjmp_buf, int) { return 0; }
static inline void siglongjmp(sigjmp_buf, int) { abort(); }
