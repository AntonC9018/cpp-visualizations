#pragma once
#include <__typedef_sa_family_t.h>
#define __wasilibc___struct_sockaddr_un_h 1
struct sockaddr_un {
  __attribute__((aligned(__BIGGEST_ALIGNMENT__))) sa_family_t sun_family;
  char sun_path[108];
};
#include_next <sys/un.h>
