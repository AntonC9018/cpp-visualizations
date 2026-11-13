#pragma once
#include <sys/types.h>
#include <sys/mman.h>
struct passwd {
  char *pw_name;
  char *pw_passwd;
  uid_t pw_uid;
  gid_t pw_gid;
  char *pw_gecos;
  char *pw_dir;
  char *pw_shell;
};
static inline int getpwnam_r(const char *, struct passwd *, char *, size_t, struct passwd **result) {
  if (result) *result = NULL;
  return 0;
}
static inline int getpwuid_r(uid_t, struct passwd *, char *, size_t, struct passwd **result) {
  if (result) *result = NULL;
  return 0;
}
