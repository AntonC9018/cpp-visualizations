#pragma once
#include_next <sys/statvfs.h>
#ifndef MNT_LOCAL
#define MNT_LOCAL 0x1000
#endif
#ifndef f_flags
#define f_flags f_flag
#endif
