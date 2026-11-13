#pragma once
#include_next <sys/stat.h>
static inline mode_t umask(mode_t) { return 0022; }
