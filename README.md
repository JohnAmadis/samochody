# Porównywarka samochodów (lokalnie, Docker + MySQL)

Aplikacja web do zapisywania i porównywania ofert samochodowych bez logowania.

## Co potrafi

- Dodawanie ogłoszeń przez URL (np. Otomoto/Autoplac) z automatycznym pobieraniem danych, jeśli parser je znajdzie.
- Lokalne zapisywanie zdjęć ofert do wolumenu Dockera.
- Tabela ofert z najważniejszymi kolumnami i szybkim filtrem statusu.
- Przeliczanie odległości i czasu dojazdu dla pojedynczego wpisu, z zapisem wyniku w bazie.
- Statusy: `Nowe`, `Do kontaktu`, `W trakcie`, `Do sprawdzenia`, `Odrzucone`, `Nieaktualne`.
- Ocena subiektywna i ocena historii pojazdu (1-5) bezpośrednio w tabeli przez klikalne gwiazdki.
- Graficzny status ogłoszenia + szybkie akcje: odrzuć, usuń.
- Osobne przyciski postępu: przejrzane dokładnie, kontakt wykonany, ogłoszenie sprawdzone.
- Edycja komentarzy, historii, telefonu i roku sprowadzenia.
- Widok porównania zaznaczonych aut.

## Szybki start (one-command)

W katalogu projektu uruchom:

```bash
./start-server.sh
```

Skrypt buduje obraz aplikacji, uruchamia bazę i omija błąd `ContainerConfig` ze starego `docker-compose` v1.

Klucz OpenRouteService wpisz raz w pliku [.env](.env) w polu `ORS_API_KEY=`.

Po uruchomieniu:

- UI: http://localhost:18080 (domyślnie)
- MySQL: localhost:3307

Jeśli chcesz użyć innego portu hosta, uruchom:

```bash
APP_PORT=3000 ./start-server.sh
```

Baza i obrazy są trwałe dzięki wolumenom `mysql-data` i `app-images`.

## Struktura

- `docker-compose.yml` – usługi `app` i `db`
- `Dockerfile` – obraz aplikacji Node.js
- `src/server.js` – backend + routing + renderowanie EJS
- `src/scraper.js` – pobieranie danych z URL
- `src/imageStore.js` – lokalny zapis zdjęć
- `src/schema.sql` – schemat MySQL

## Uwagi o imporcie

- Źródła ogłoszeń zmieniają HTML i stosują zabezpieczenia antybot, więc import jest best-effort.
- Gdy auto-import nie pobierze wszystkich pól, użyj formularza ręcznego i edycji rekordu.
- Przed intensywnym scrapowaniem zweryfikuj regulaminy serwisów źródłowych.

## Zatrzymanie

```bash
docker compose down
```

Aby usunąć także dane (DB i obrazy):

```bash
docker compose down -v
```
