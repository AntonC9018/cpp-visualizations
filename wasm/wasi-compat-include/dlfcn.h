#pragma once
#include_next <dlfcn.h>
typedef struct {
  const char *dli_fname;
  void *dli_fbase;
  const char *dli_sname;
  void *dli_saddr;
} Dl_info;
static inline int dladdr(const void *, Dl_info *info) {
  if (info) { info->dli_fname = ""; info->dli_fbase = nullptr; info->dli_sname = nullptr; info->dli_saddr = nullptr; }
  return 0;
}
