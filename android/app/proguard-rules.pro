# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# ══════════════════════════════════════════════════════════════════
# 🔴 NATIVE-CORE (Phase N1) — JNI KEEP KURALLARI (KRİTİK)
# release build'de minifyEnabled=true + shrinkResources=true aktif.
# Bu kurallar olmadan R8, native metotları ve JNI'den çağrılan bridge
# sınıfını "kullanılmıyor" sanıp strip eder → release'de UnsatisfiedLinkError.
# Debug'da görünmez; SADECE imzalı APK'da patlar.
# ══════════════════════════════════════════════════════════════════

# 1) Tüm native metot imzalarını ve onları barındıran sınıf adlarını koru.
-keepclasseswithmembernames,includedescriptorclasses class * {
    native <methods>;
}

# 2) Native bridge sınıfını ve üyelerini tam koru (JNI RegisterNatives / FindClass hedefi).
-keep class com.cockpitos.pro.core.VehicleNativeBridge { *; }

# 3) İleride C++'tan Java'ya geri çağrılacak (callback) sınıflar buraya eklenecek (Phase N2+).
# -keep class com.cockpitos.pro.core.** { *; }

# ══════════════════════════════════════════════════════════════════
# 🔴 VOSK (offline STT) + JNA — KEEP KURALLARI (KRİTİK)
# vosk-android 0.3.47, libvosk.so'ya JNA (Java Native Access) ile reflection
# üzerinden bağlanır. Ne vosk ne jna AAR'ı consumer-proguard kuralı taşır →
# release'de R8 (minifyEnabled=true) JNA/Vosk sınıflarını strip/obfuscate eder →
# Recognizer/SpeechService init veya model unpack runtime'da patlar.
# Debug'da (minify yok) görünmez; SADECE imzalı release APK'da head unit'te patlar.
# ══════════════════════════════════════════════════════════════════

# Vosk Java API yüzeyi (Model, Recognizer, SpeechService, RecognitionListener)
-keep class org.vosk.** { *; }
-dontwarn org.vosk.**

# JNA — native dispatch tamamen reflection tabanlı; tüm sınıf/üyeler korunmalı.
-keep class com.sun.jna.** { *; }
-keepclassmembers class com.sun.jna.** { *; }
-dontwarn com.sun.jna.**

# JNA Structure/Callback türevleri (alan sırası ve isimleri native ABI ile birebir
# eşleşmeli — obfuscation alan adlarını bozar → native struct hizalaması çöker).
-keep class * extends com.sun.jna.** { *; }
-keep class * implements com.sun.jna.** { *; }
-keepclassmembers class * extends com.sun.jna.Structure {
    <fields>;
}
