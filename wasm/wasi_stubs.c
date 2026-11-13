#include <errno.h>
#include <stddef.h>
#include <string.h>

int gethostname(char *name, size_t len) {
  if (!name || len == 0) {
    errno = EINVAL;
    return -1;
  }
  const char *host = "wasi";
  size_t n = strlen(host);
  if (n >= len) n = len - 1;
  memcpy(name, host, n);
  name[n] = '\0';
  return 0;
}

int posix_madvise(void *addr, size_t len, int advice) {
  (void)addr;
  (void)len;
  (void)advice;
  return 0;
}
