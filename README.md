# PROXY_LIST — Cloudflare Pages

Адаптивный интерфейс для общей библиотеки прокси с раздельными категориями **MTProto**, **SOCKS** и **WEB**. У каждого адреса собственная кнопка копирования. Есть копирование всей библиотеки или категории, поиск, экспорт TXT и JSON API.

## Структура

- `index.html` — интерфейс и клиентская логика.
- `_worker.js` — Cloudflare Pages Advanced Mode Worker: собирает, классифицирует и удаляет дубликаты.
- `wrangler.toml` — конфигурация Wrangler для Pages.
- `favicon.svg` — иконка сайта.
- `data/proxies.txt` — записи, добавленные вручную.
- `sources.txt` — список открытых HTTPS-источников.

## Форматы записей

Добавляй **по одной записи на строку** в `data/proxies.txt` или в поддерживаемый текстовый источник:

- **MTProto:** `tg://proxy?...` или `https://t.me/proxy?...`
- **SOCKS:** `socks5://host:port`, `socks4://host:port`, `socks5://user:password@host:port`, либо распространённый формат `host:port:user:password`.
- **WEB:** `http://host:port`, `https://host:port` или `host:port`.

Для WEB прокси с учётными данными используй URL с `http://` или `https://`. Строки, начинающиеся с `#` или `//`, считаются комментариями. URL-ы источников в `sources.txt` должны начинаться с `https://`; источник должен содержать текстовые строки или ссылки поддерживаемых форматов. Максимум обрабатывается 30 URL-источников за один запрос.

Система проверяет базовый формат и убирает точные дубликаты внутри типа. Она **не проверяет доступность, анонимность или скорость** прокси. Публикуй только адреса и данные, которые имеешь право распространять: содержимое списка доступно каждому посетителю сайта.

## HTTP endpoints

| Endpoint | Результат |
|---|---|
| `/proxy.txt` | Все категории, одна запись на строку |
| `/mtproto.txt` | Только MTProto |
| `/socks.txt` | Только SOCKS |
| `/web.txt` | Только WEB / HTTP(S) |
| `/api/proxies` | JSON со счётчиками, массивом `proxies` и объектом `categories` |
| `/api/proxies?type=mtproto` | JSON только с указанным типом; доступны `mtproto`, `socks`, `web` |
| `/health` | Проверка доступности Worker |

Результаты кэшируются на 5 минут. Кэш — это ускорение ответа, а не проверка состояния прокси.

## Деплой на Cloudflare Pages

1. Убедись, что `index.html`, `_worker.js` и `wrangler.toml` лежат в корне проекта, а `data/proxies.txt` — в папке `data/`.
2. В Cloudflare открой **Workers & Pages → Create → Pages → Connect to Git** и подключи репозиторий `vrema7760-cyber/PROXY_LIST`.
3. Build command оставь пустой (это статический сайт без сборки). Build output directory — `.`.
4. Деплой должен использовать **Pages Functions Advanced Mode**: `_worker.js` в директории вывода отвечает за маршруты API и возвращает статические файлы через `env.ASSETS.fetch()`.
5. После деплоя проверь `/health`, `/api/proxies`, `/mtproto.txt`, `/socks.txt` и `/web.txt`.

`wrangler.toml` задаёт `pages_build_output_dir = "."` и дату совместимости Worker. Если проект уже настроен в Cloudflare Dashboard, сверяй конфигурацию перед тем, как делать этот файл источником истины для production.

Для локального запуска установи Wrangler и используй `npx wrangler pages dev .` из корня репозитория.
