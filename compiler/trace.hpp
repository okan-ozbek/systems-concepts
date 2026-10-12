#include <type_traits>
#include <cstddef>
#include <cstdio>
#include <array>
#include <vector>
extern "C" {
__attribute__((import_module("lab"), import_name("checkpoint"))) void __lab_checkpoint(int, int);
__attribute__((import_module("lab"), import_name("watch"))) void __lab_watch(const char*, const void*, unsigned, unsigned, unsigned);
}
inline void __lab_begin(int line, int phase) { std::fflush(nullptr); __lab_checkpoint(line, phase); }
template<class T> void __lab_capture(const char* name, const T& value) {
  using Element = std::remove_cv_t<std::remove_all_extents_t<T>>;
  if constexpr (std::is_arithmetic_v<Element> && sizeof(Element) <= 8) {
    unsigned kind = std::is_floating_point_v<Element> ? 2 : std::is_signed_v<Element> ? 1 : 0;
    __lab_watch(name, &value, sizeof(value), sizeof(Element), kind);
  }
}
template<class T, std::size_t N> void __lab_capture(const char* name, const std::array<T,N>& value) {
  if constexpr (std::is_arithmetic_v<T> && sizeof(T) <= 8) {
    unsigned kind = std::is_floating_point_v<T> ? 2 : std::is_signed_v<T> ? 1 : 0;
    __lab_watch(name, value.data(), N * sizeof(T), sizeof(T), kind);
  }
}
template<class T, class A> void __lab_capture(const char* name, const std::vector<T,A>& value) {
  if constexpr (std::is_arithmetic_v<T> && !std::is_same_v<T,bool> && sizeof(T) <= 8) {
    unsigned kind = std::is_floating_point_v<T> ? 2 : std::is_signed_v<T> ? 1 : 0;
    __lab_watch(name, value.data(), value.size() * sizeof(T), sizeof(T), kind);
  }
}
