# ══════════════════════════════════════════════════════════════════
# CarOS Pro — Native-Core (Phase N1)
# vehicle_core: araç telemetri çekirdeğinin C++ tarafı.
# Şu an sadece "heartbeat" iskeleti; Phase N2'de Ring Buffer eklenecek.
# ══════════════════════════════════════════════════════════════════
cmake_minimum_required(VERSION 3.22.1)

project("vehicle_core" LANGUAGES CXX)

# Otomotiv low-end hedef: boyut + hız dengesi. NEON build.gradle'dan gelir.
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(vehicle_core SHARED
        native-core.cpp
        # Header-only bileşenler (derleme birimi değil; IDE indeksleme + bağımlılık takibi):
        VehicleState.hpp)    # Phase N2: Seqlock + cache-line hizalı araç durumu

# Header'lar aynı dizinde — include yolu.
target_include_directories(vehicle_core PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})

# Android log kütüphanesi (logcat'e heartbeat yazmak için)
find_library(log-lib log)

target_link_libraries(vehicle_core
        ${log-lib})
