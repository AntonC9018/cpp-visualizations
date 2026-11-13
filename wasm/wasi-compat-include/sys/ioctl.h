#pragma once
#include_next <sys/ioctl.h>
struct winsize {
  unsigned short ws_row;
  unsigned short ws_col;
  unsigned short ws_xpixel;
  unsigned short ws_ypixel;
};
#ifndef TIOCGWINSZ
#define TIOCGWINSZ 0x5413
#endif
