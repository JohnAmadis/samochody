# Instrukcje dla GitHub Copilot – projekt `samochody`

## Uruchamianie serwera

**Zawsze używaj skryptu `start-server.sh`** do budowania i startowania aplikacji.
Aplikacja działa w Dockerze (docker-compose). Bezpośrednie `npm run start` lub `node src/server.js` **nie zadziała** – serwis wymaga bazy MySQL w kontenerze.

```bash
bash start-server.sh
```

Aplikacja będzie dostępna pod: **http://localhost:18080** (lub port z `APP_PORT`).

Skrypt automatycznie:
1. Startuje kontener bazy danych (`db`).
2. Buduje obraz aplikacji (`app`).
3. Usuwa stary kontener `app` (obejście błędu ContainerConfig).
4. Uruchamia nowy kontener `app`.

## Architektura

- **Backend**: Node.js + Express, plik wejściowy `src/server.js`
- **Widoki**: EJS (`src/views/`)
- **Style**: `src/public/styles.css`
- **Baza danych**: MySQL 8.4 (kontener Docker), schemat w `src/schema.sql`, migracje w `src/initDb.js`
- **Scraper**: `src/scraper.js` – obsługuje otomoto i autoplac
- **Obrazy**: wolumen Docker `app-images`, dostępne pod `/images/`

## Ważne szczegóły

- Port zewnętrzny aplikacji: `${APP_PORT:-18080}` → wewnętrznie `3000`
- Port bazy MySQL na hoście: `3307` (wewnętrznie `3306`)
- Wyposażenie samochodu zapisywane jest jako JSON w kolumnie `equipment TEXT` w tabeli `listings`
- Autoplac używa Angular SSR – wyposażenie jest w JSON embeddowanym w HTML (`"equipment":[...]`), **nie** w elementach `<li>`
