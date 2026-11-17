// The WASM frontend only parses snippets. Supply the aggregate layout and signatures
// used by the tracer, alongside the virtual standard headers built into Clang.
export const ARRAY_PREAMBLE = `
namespace std {
template<class T, size_t N> struct array {
  using value_type = T;
  using size_type = size_t;
  using pointer = T*;
  using const_pointer = const T*;
  using reference = T&;
  using const_reference = const T&;
  T elements[N];
  constexpr reference operator[](size_type i) noexcept { return elements[i]; }
  constexpr const_reference operator[](size_type i) const noexcept { return elements[i]; }
  constexpr pointer data() noexcept { return elements; }
  constexpr const_pointer data() const noexcept { return elements; }
  constexpr size_type size() const noexcept { return N; }
};
template<class T> struct array<T, 0> {};
template<class T, class... U> requires (__is_same(T, U) && ...)
array(T, U...) -> array<T, 1 + sizeof...(U)>;
}
`;
