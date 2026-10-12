// Under the Hood: real measurements to pair with the animated lessons.
// g++ -O3 -std=c++20 -pthread experiments.cpp -o experiments
// ./experiments locality 8388608
// ./experiments sharing 10000000
// ./experiments layout 8388608
#include <algorithm>
#include <atomic>
#include <barrier>
#include <chrono>
#include <cstdint>
#include <cstdlib>
#include <iostream>
#include <numeric>
#include <random>
#include <string>
#include <thread>
#include <vector>

using Clock = std::chrono::steady_clock;
template<class F> void measure(const char* name, F work) {
  const auto begin = Clock::now();
  const auto checksum = work();
  const auto end = Clock::now();
  std::cout << name << ": "
            << std::chrono::duration<double, std::milli>(end - begin).count()
            << " ms; checksum = " << checksum << '\n';
}

void locality(std::size_t n) {
  std::vector<int> data(n);
  std::iota(data.begin(), data.end(), 0);
  std::vector<std::size_t> order(n);
  std::iota(order.begin(), order.end(), 0);
  std::mt19937 rng(42);
  std::shuffle(order.begin(), order.end(), rng);
  std::cout << "Data working set: " << n * sizeof(int) / 1048576.0
            << " MiB. Shuffled indices add a separate working set.\n";
  for (int repeat = 0; repeat < 3; ++repeat) {
    auto sequential = [&] {
      std::uint64_t sum = 0;
      for (std::size_t i = 0; i < n; ++i) sum += data[i];
      return sum;
    };
    auto scattered = [&] {
      std::uint64_t sum = 0;
      for (std::size_t i : order) sum += data[i];
      return sum;
    };
    // Alternate the order to reduce fixed-order bias. Both are warm runs;
    // this is a locality experiment, not a precise cold-cache measurement.
    if (repeat % 2) { measure("scattered", scattered); measure("sequential", sequential); }
    else { measure("sequential", sequential); measure("scattered", scattered); }
  }
}

struct Packed { std::atomic<std::uint64_t> a{0}, b{0}; };
// This experiment assumes a 64-byte coherence line. Confirm on your CPU.
struct alignas(64) Counter { std::atomic<std::uint64_t> value{0}; };
struct Separated { Counter a, b; };
void increments(std::atomic<std::uint64_t>& a,
                std::atomic<std::uint64_t>& b, std::size_t n) {
  std::barrier ready(3);
  auto work = [&](std::atomic<std::uint64_t>& counter) {
    ready.arrive_and_wait();
    for (std::size_t i = 0; i < n; ++i)
      counter.fetch_add(1, std::memory_order_relaxed);
  };
  std::thread t0([&] { work(a); });
  std::thread t1([&] { work(b); });
  const auto start = Clock::now();
  ready.arrive_and_wait();
  t0.join(); t1.join();
  std::cout << std::chrono::duration<double, std::milli>(Clock::now() - start).count()
            << " ms; checksum = " << a.load() + b.load() << '\n';
}
void sharing(std::size_t n) {
  std::cout << "Use two physical cores for a meaningful comparison. OS scheduling\n"
               "can put both threads on one core; repeat and inspect CPU placement.\n";
  for (int repeat = 0; repeat < 3; ++repeat) {
    // Alignment keeps both packed counters within one assumed 64-byte line.
    alignas(64) Packed packed;
    Separated separated;
    std::cout << "same line: "; increments(packed.a, packed.b, n);
    std::cout << "separate lines: "; increments(separated.a.value, separated.b.value, n);
  }
}

struct Node { Node* next = nullptr; int value = 1; };
void layout(std::size_t n) {
  std::vector<int> array(n, 1);
  std::vector<Node> nodes(n);
  std::vector<std::size_t> order(n);
  std::iota(order.begin(), order.end(), 0);
  std::mt19937 rng(42);
  std::shuffle(order.begin(), order.end(), rng);
  for (std::size_t i = 1; i < n; ++i) nodes[order[i - 1]].next = &nodes[order[i]];
  Node* head = &nodes[order[0]];
  std::cout << "Array: " << n * sizeof(int) / 1048576.0 << " MiB; nodes: "
            << n * sizeof(Node) / 1048576.0 << " MiB. Different footprint and\n"
               "dependency structure are both part of this comparison.\n";
  for (int repeat = 0; repeat < 3; ++repeat) {
    measure("contiguous array", [&] {
      std::uint64_t sum = 0;
      for (int value : array) sum += value;
      return sum;
    });
    measure("scattered pointer chain", [&] {
      std::uint64_t sum = 0;
      for (Node* p = head; p; p = p->next) sum += p->value;
      return sum;
    });
  }
}

int main(int argc, char** argv) {
  try {
    const std::string mode = argc > 1 ? argv[1] : "locality";
    const auto n = argc > 2 ? std::stoull(argv[2]) : 8388608ULL;
    if (n == 0 || n > 100000000ULL) {
      std::cerr << "Use a size between 1 and 100000000.\n"; return 1;
    }
    if (mode == "locality") locality(n);
    else if (mode == "sharing") sharing(n);
    else if (mode == "layout") layout(n);
    else { std::cerr << "Modes: locality, sharing, layout\n"; return 1; }
  } catch (const std::exception& error) {
    std::cerr << error.what() << '\n'; return 1;
  }
}
