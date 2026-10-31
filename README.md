# no-internet-yt

Canlı yayım üçün "No Internet" səhifəsi: çəmənlikdə yatan personaj, xoruldama səsi, fon ambiyansı və öz-özünə oynayan dino.

## İşə salmaq
`index.html` faylını brauzerdə açın (və ya OBS → Browser Source). Səs üçün bir dəfə "Başla"-ya klikləyin
(OBS Browser Source-da klik tələb olunmur).

## Klavişlər
`F` tam ekran · `M` musiqi on/off · `S` xoruldama on/off. Siçanı tərpətsəniz səs paneli görünür, 3 san sonra gizlənir.

## URL parametrləri
- `?music=0.35` fon musiqisinin səsi (0–1)
- `?snore=0.7` xoruldama səsi (0–1)
- `?mistakes=0.006` dino-nun hər maneədə səhv etmə ehtimalı (0 = heç vaxt uduzmur)
- `?manual=1` dino-nu özünüz oynayın (Space / ↑)

## Fayllar
- `assets/sprite.png` — frames.png-dən arxa fonu təmizlənmiş 4×4 sprite
- `assets/dino/` — dino/cactus/bird/track sprites from [dhhruv/Chrome-Dino-Runner](https://github.com/dhhruv/Chrome-Dino-Runner) (MIT), converted to clean dark silhouettes
- `assets/meadow-boost.mp3` — meadow.mp3-ün səs səviyyəsi qaldırılmış variantı (orijinal çox sakit idi)
