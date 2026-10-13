# BOAT 1.11.0

BOATFLIX 1.37 ile içerik sayfası canlı TMDB oyuncu ve yönetmen kimliklerini,
fotoğraflarını, rollerini, başlık logosunu ve sezon kapaklarını kullanır.
Kişi kartı biyografi, film ve dizi filmografisini açar. Türkçe bilgi yoksa
mevcut İngilizce biyografi kullanılır; olmayan bilgi veya görsel üretilmez.

`src/boat-interactive.js` okunabilir ek kaynaktır. Üst projenin atıflı paketi
korunur; `node tools/build-provider.cjs` eki `providers/boat.js` içine ekler.
Eski istemciler için `cast` isim listesi korunur; zengin kişi kayıtları
`app_extras.cast` ve `app_extras.directors` içinde taşınır.

Kaynak araması yalnız Torrentio, TorrentsDB ve ThePirateBay+ üzerinde yapılır.
Üç istek paraleldir, her sağlayıcının ağ/JSON beklemesi en fazla 5 saniyedir.
IMDb kimliği zaten biliniyorsa TMDB veya Wikidata kimlik sorgusu yapılmaz.
BOATFLIX'in `__emit_streams` köprüsüne hazır gruplar hemen gönderilir;
eski istemciler aynı kaynakları tamamlanmış dizi olarak alır.
HLS kaynakları çağrılmaz ve sonuçlara eklenmez. Altyazı araması korunur.
Torrentin gerçek dosya indeksi/adı/boyutu korunur; tekrarlar hash + dosya
kimliğiyle temizlenir. Film/dizi dosyası bu testlerde indirilmez.

## Doğrulama

- `node --test tools/interactive.test.cjs`: 8 test, sıfır başarısızlık/atlama.
  Bir sağlayıcı dururken diğerlerinin erken gelmesi, 5 saniyelik sonlandırma,
  başarısız servis, HTTP kaynaklarını eleme, tekrarlar, dosya kimliği, sezon 0,
  oyuncu/yönetmen/logo/sezon verileri kontrol edilir.
- `node tools/live-metadata-qa.cjs`: isteğe bağlı ve yalnız okunur canlı kontrol.
  13 Ekim 2026'da gerçek Suits IMDb `tt1632701` → TMDB `37680` eşleşmesi geçti.
  672 oyuncu, 547 fotoğraf/kimlik kaydı, 59 yaratıcı ekip kaydı ve özel bölümler
  dahil 10 farklı sezon posteri alındı. İlk oyuncunun biyografisi, 23 film ve
  10 dizi kredisi bulundu. Oyuncu fotoğrafı, başlık logosu ve iki sezon posteri
  HTTP 200 döndü. Sayılar TMDB'deki güncel verilere göre değişebilir.
- Uygulama tarafındaki gerçek QuickJS motoru, yalnız loopback fixture'ına
  bağlanan eklenti dosyasıyla ayrıca doğrulanır. Uygulama paketleri ve cihaz
  testleri BOATFLIX deposunun raporunda yer alır.

Kaynakların görünme süresi sağlayıcı, peer ve video doğrulama sürelerine de
bağlıdır; 5 saniyelik sınır tüm videoların 5 saniyede oynayacağı anlamına gelmez.
BOATFLIX'in mevcut görüntü/seed/boyut kontrolleri ve doğru bölüm seçimi korunur.

API belgeleri: [aggregate credits](https://developer.themoviedb.org/reference/tv-series-aggregate-credits),
[person combined credits](https://developer.themoviedb.org/reference/person-combined-credits),
[images](https://developer.themoviedb.org/reference/tv-series-images).
