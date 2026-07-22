<p align="center">
  <a href="README.md">한국어</a> · <a href="README.en.md">English</a> · <a href="README.ja.md">日本語</a> ·
  <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a> · <a href="README.fr.md">Français</a> ·
  <a href="README.de.md">Deutsch</a> · <a href="README.it.md">Italiano</a> · <a href="README.ru.md">Русский</a> · <strong>Türkçe</strong>
</p>

<div align="center">
  <img src="public/logo.png" alt="Gajae App logosu" width="96" height="96">
  <h1>Gajae App</h1>
  <p><strong>Gajae Code için yerel öncelikli yapay zekâ kodlama masaüstü</strong></p>
  <p>Projeleri, oturumları, ajan ön ayarlarını ve becerileri tek çalışma alanında yönetin.</p>
</div>

<p align="center">
  <a href="https://github.com/devswha/gajae-code-app/actions/workflows/ci.yml"><img src="https://github.com/devswha/gajae-code-app/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/devswha/gajae-code-app/releases"><img src="https://img.shields.io/github/v/release/devswha/gajae-code-app?include_prereleases&label=release" alt="GitHub sürümü"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/devswha/gajae-code-app" alt="AGPL-3.0-or-later"></a>
  <img src="https://img.shields.io/badge/macOS-Apple%20Silicon-111111?logo=apple" alt="macOS Apple Silicon">
</p>

<p align="center">
  <a href="https://github.com/devswha/gajae-code-app/releases/tag/v2.0.0-beta.2"><strong>macOS için indir</strong></a> ·
  <a href="#temel-özellikler">Özellikler</a> · <a href="#kaynaktan-çalıştırma">Geliştirme</a> ·
  <a href="https://github.com/devswha/gajae-code-app/issues">Sorunlar</a>
</p>

<p align="center"><img src="public/screenshots/gajae-app-overview.jpg" alt="Oturumların projelerin altında bulunduğu Gajae App" width="920"></p>
<p align="center"><sub>Projeyi genişletin, oturumlarına ulaşın ve aynı alanda yeni bir GJC görevi başlatın.</sub></p>

## Gajae App nedir?

Gajae App, [Gajae Code](https://github.com/devswha/gajae-code) kullanmak için açık kaynaklı masaüstü ve tarayıcı çalışma alanıdır. GJC oturumlarını başlatır ve sürdürür; akış yanıtlarını ve araç çalışmalarını projeye göre düzenler.

Uygulama bir yapay zekâ modeli veya abonelik sağlamaz. Gajae Code içinde yapılandırılmış hesapları, modelleri ve ajanları kullanır. Proje dosyaları ve çalışma durumu uygulamanın çalıştığı makinede kalır.

> Bu depo **yalnızca GJC için v2 beta ürün serisidir**. Önceki tmux ve çoklu sağlayıcı arayüzü [gaminus](https://github.com/devswha/gaminus) içinde korunmaktadır.

## Temel özellikler

- **Proje odaklı oturumlar** — İlgili oturumlar genişletilen projenin hemen altında görünür.
- **Hızlı yeni görev** — **New task** veya proje satırındaki `+` ile GJC oturumu başlatın.
- **Ajan ön ayarları** — Default, Planner, Executor, Architect ve Critic modellerini ve reasoning effort değerlerini birlikte değiştirin.
- **Sohbet içi beceriler** — `/skill:<name>` ile proje, kullanıcı ve yerleşik becerileri arayın.
- **Canlı zaman çizelgesi** — Akış, düşünme durumu, araç çağrıları, onaylar, durdurma ve sürdürmeyi tek konuşmada izleyin.
- **Arşivleme ve geri yükleme** — Projeleri ve oturumları silmeden arşivleyin.
- **Yerel dosyalar** — Görev bağlamından çıkmadan proje dosyalarını açın.
- **Masaüstü ve Web için ortak çekirdek** — Tauri ile tarayıcı aynı yerel sunucuyu ve GJC çalışma sınırını paylaşır.

## Arayüz

<table><tr>
<td width="50%" align="center"><img src="public/screenshots/model-presets.jpg" alt="Ajan ön ayarı seçici"><br><sub><b>Ajan ön ayarları</b><br>Varsayılan ajanı ve dört uzman rolü birlikte yapılandırın</sub></td>
<td width="50%" align="center"><img src="public/screenshots/skill-commands.jpg" alt="Beceri komut menüsü"><br><sub><b>Beceri komutları</b><br>Becerileri doğrudan sohbetten arayın</sub></td>
</tr></table>

## macOS uygulamasını kurma

Genel beta şu anda **macOS 11 veya üstünde Apple Silicon (M1 veya daha yeni)** cihazları destekler.

1. DMG ve aynı adlı `.sha256` dosyasını [v2.0.0-beta.2 sürümünden](https://github.com/devswha/gajae-code-app/releases/tag/v2.0.0-beta.2) indirin.
2. Sağlama toplamını doğrulayın:

   ```bash
   cd ~/Downloads
   shasum -a 256 -c gajae-app-desktop-2.0.0-beta.2-macos-arm64.dmg.sha256
   ```

3. DMG’yi açın ve **Gajae App** uygulamasını **Applications** klasörüne sürükleyin.
4. İlk çalıştırmada Finder’da uygulamaya Control ile tıklayıp **Aç** seçeneğini kullanın. Engellenirse **Sistem Ayarları → Gizlilik ve Güvenlik → Yine de Aç** yolunu izleyin.

> Beta DMG ad hoc imzalıdır ve henüz Apple tarafından noterlenmemiştir. Yalnızca GitHub Releases dosyasını, eşleşen sağlama toplamıyla kullanın.

| Hedef | Durum | Gereksinimler |
|---|---|---|
| macOS arm64 masaüstü | Beta DMG mevcut | macOS 11+, Apple Silicon |
| Linux x86_64 sunucu | Beta sunucu paketi mevcut | glibc 2.35+, Node.js 22 |
| Tarayıcı geliştirme | Kaynaktan çalıştırma | Node.js 22 veya 24 |
| Intel Mac / Windows / Linux masaüstü | Henüz desteklenmiyor | Paketleme ve doğrulama gerekli |

## Temel kullanım

1. Yerel çalışma alanı eklemek için **Projects** yanındaki `+` düğmesini kullanın.
2. Var olan oturumu açmak için projeyi genişletin veya yeni oturum için satırdaki `+` düğmesine basın.
3. İleti alanındaki ön ayar seçiciden ajan yapılandırmasını seçin.
4. İstemi gönderin; yanıtları, araçları ve onayları canlı izleyin.
5. Temel komutlar için `/`, beceri aramak için `/skill:` yazın.

## Ön ayarlar ve beceriler

Seçici; **Current yapılandırmasını**, GJC `0.11.1` için **28 yerleşik ön ayarı** ve kullanıcı ön ayarlarını birleştirir.

- Özel ön ayarlar: `~/.gjc/agent/models.yml`
- Geçerli rol yapılandırması: `~/.gjc/agent/config.yml`

`/skill:` becerileri şu öncelik sırasıyla birleştirir:

1. Proje: `<workspace>/.gjc/skills/<name>/SKILL.md`
2. Kullanıcı: `~/.gjc/agent/skills/<name>/SKILL.md`
3. Gajae App yerleşik becerileri

Görünen bir beceri geçerli `name` ve `description` alanlarına sahip olmalıdır. `enabled: false` veya `hide: true` beceriyi gizler.

## Kaynaktan çalıştırma

Node.js `22.22.2+` veya `24.15.0+`, npm, Git ve yapılandırılmış Gajae Code gereklidir. Masaüstü derlemesi ayrıca rustup üzerinden Rust `1.85.1` ister.

```bash
git clone https://github.com/devswha/gajae-code-app.git
cd gajae-code-app
npm ci
npm run dev
```

<http://127.0.0.1:5173> adresini açın. Tauri geliştirmesi için `npm run desktop:dev` çalıştırın.

## Mimari

```text
React UI (Browser / Tauri)
          │ HTTP + WebSocket
          ▼
Gajae App local server
          │
          ├── SQLite · project files · Git/worktree
          ▼
gajae-core (Rust process host)
          │ private stdio protocol
          ▼
GJC worker ──▶ Gajae Code CLI / SDK
```

Rust çekirdeği süreçleri, dosya izlemeyi, görev durumunu ve PTY sınırlarını yönetir. Masaüstü yalnızca loopback sunucusuna bağlanır ve yerel oturumu bootstrap nonce ile `HttpOnly` çereziyle korur. Ayrıntılar için [mimari yol haritasına](docs/GJC-DESKTOP-ARCHITECTURE-ROADMAP.md) ve [Tauri doğrulama kaydına](docs/DESKTOP-TAURI-VERIFICATION.md) bakın.

## Geliştirme komutları

| Komut | Amaç |
|---|---|
| `npm run dev` | React ve geliştirme sunucusunu başlatır |
| `npm run desktop:dev` | Tauri masaüstünü başlatır |
| `npm test` | Sunucu ve istemci testlerini çalıştırır |
| `npm run typecheck` | TypeScript’i denetler |
| `npm run lint` | ESLint’i çalıştırır |
| `npm run build` | İstemciyi, sunucuyu ve Rust çekirdeğini derler |
| `npm run verify` | Tüm kalite kontrollerini çalıştırır |

## Durum ve lisans

Gajae App v2 beta aşamasındadır. Güncellemeden önce `~/.gajae-app/data` ve GJC yapılandırmasını yedekleyin. Sorunları işletim sistemi, uygulama sürümü ve yeniden üretme adımlarıyla [Issues](https://github.com/devswha/gajae-code-app/issues/new) bölümüne bildirin.

Gajae App [GNU AGPL v3.0 or later](LICENSE) ile dağıtılır. Siteboon AI B.V. upstream arayüzünden başlayarak GJC’ye özel bir ürün olarak yeniden oluşturulmuştur. Atıf için [NOTICE](NOTICE), upstream politikası için [docs/UPSTREAM.md](docs/UPSTREAM.md) dosyasına bakın.
