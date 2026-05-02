# Import från Visual Arkiv 7

> **Språk:** Denna guide är skriven på svenska eftersom funktionen är specifik för svenska arkivinstitutioner och den pågående avvecklingen av Visual Arkiv som system.

---

Kurbits stödjer import av exportfiler från **Visual Arkiv 7** via ett kommandoradsverktyg.

> ⚠️ **Viktigt:** Importfunktionen är enbart testad mot Visual Arkiv 7 och enbart mot arkiv som förtecknats enligt **Allmänna Arkivschemat** (AA-schemat) med seriebeteckningar på formen Y + Z + A (t.ex. A1, F2a). Stöd för verksamhetsbaserad arkivredovisning (processorienterad förteckning) finns inte implementerat i nuläget.
>
> Om du vill bidra till att utveckla stöd för verksamhetsbaserad arkivredovisning — antingen som utvecklare eller genom att dela exempelfiler — är du välkommen att kontakta projektets upphovsman eller öppna ett ärende i repositoriet.

---

## Vad importeras

Från en Visual Arkiv 7 XML-export skapas följande i Kurbits:

| Visual Arkiv | Kurbits |
|---|---|
| Arkivbildare | Agent (organisation, person eller familj) |
| Arkiv | Resurs på nivå Fonds |
| SerieAA | Resurs på nivå Series |
| Volym | Resurs på nivå Volume |

**Arkivbildaren** importeras som agent med:
- Namn (auktoriserad namnform)
- Verksamhetsperiod (datum från/till)
- Historik → anteckning av typen *history*

**Arkivet** importeras som Fonds med:
- Titel
- Arkivnummer som lokalt referensnummer
- Tidsbegränsning (från/till)
- Hyllmeter (omräknat från millimeter till hyllmeter)
- Placering, anteckningar, sekretessmarkering
- Historik → anteckning av typen *administrative_history*

Arkivbildaren länkas automatiskt till sitt arkiv med relationstypen *creator*.

**Serien** importeras med:
- Serierubrik
- Seriebeteckning sammansatt av Y + Z + A (t.ex. `A`, `1` → `A1`; `F`, `2`, `a` → `F2a`)
- Anmärkningar, placering, sekretess, gallringsinformation

**Volymen** importeras med:
- Volumnummer
- Tidsintervall
- Placering, förvaringsenhetstyp, omfång, anmärkningar

---


## Köra importen

Lägg exportfilen i en katalog som är tillgänglig för servern, t.ex. `/app/visual/`.

### Grundläggande import

```bash
flask import-visual-arkiv --institution-id 1 --file devdata/VA7_export.xml
```

### Provkörning (ingen data skrivs)

```bash
flask import-visual-arkiv --institution-id 1 --file devdata/VA7_export.xml --dry-run
```

Provkörningen visar vad som *skulle* importeras utan att faktiskt skriva något till databasen. Använd detta för att verifiera att filen tolkas korrekt.

### Utförlig loggning

```bash
flask import-visual-arkiv --institution-id 1 --file devdata/VA7_export.xml --verbose
```

Med `--verbose` visas varje skapad resurs i terminalen.

### Uppdatera befintliga arkivbildare

Som standard hoppas en arkivbildare över om en agent med samma namn redan finns i Kurbits. Med `--force-agents` uppdateras befintliga agenter istället:

```bash
flask import-visual-arkiv --institution-id 1 --file devdata/VA7_export.xml --force-agents
```

### Stora filer

För mycket stora exportfiler kan du justera hur ofta det commitas till db`--batch-size` (standard 50 arkivbildare per batch):

```bash
flask import-visual-arkiv --institution-id 1 --file devdata/VA7_export.xml --batch-size 20
```

---

## Alla flaggor

| Flagga | Typ | Standard | Beskrivning |
|---|---|---|---|
| `--institution-id` | Heltal | *Krävs* | ID för den institution som data ska importeras till |
| `--file` | Sökväg | *Krävs* | Sökväg till VA7 XML-exportfilen |
| `--force-agents` | Flagga | Av | Uppdatera befintliga agenter istället för att hoppa över dem |
| `--dry-run` | Flagga | Av | Tolka filen och räkna poster utan att skriva till databasen |
| `--batch-size` | Heltal | 50 | Töm databasen var N:e arkivbildare |
| `--verbose` | Flagga | Av | Visa varje skapad post i terminalen |

---

## Importsammanfattning

Efter körningen visas en sammanfattning:

```
── Import summary ─────────────────────────────
  Agents created : 12
  Agents skipped : 3
  Fonds created  : 12
  Series created : 87
  Volumes created: 1 204
  No errors.
```

Om fel uppstår listas de under sammanfattningen med information om vilken arkivbildare som orsakade felet. Övriga arkivbildare påverkas inte.

---

## Hierarki och referenskoder

Importen skapar eller återanvänder en ISAD(G)-hierarki för institutionen. Om hierarkin saknar nivån *Volume* skapas den automatiskt.

Referenskoder byggs upp enligt institutionens prefix:

```
SE-INST/1          ← Fonds (arkivnummer 1)
SE-INST/1/A1       ← Series (seriebeteckning A1)
SE-INST/1/A1/1     ← Volume (volym 1)
```

---

## Kända begränsningar

- **Enbart VA7** — Formatet för VA5 och VA6 skiljer sig och stöds inte.
- **Enbart Allmänna Arkivschemat** — Seriebeteckningar förutsätts följa Y+Z+A-strukturen. Verksamhetsbaserad arkivredovisning med processer och aktiviteter hanteras inte.
- **Inga digitala objekt** — Eventuella bifogade filer eller digitala objekt i VA-exporten importeras inte.
- **Inga ärendemeningar eller handlingstyper** — Dessa nivåer under volymen importeras inte i nuläget.
- **Teckenkodning** — Filen förutsätts ha iso-8859-1-kodning med en XML-deklaration som anger detta. Filer utan kodningsdeklaration tolkas som UTF-8.

---

## Framtida utveckling

Stöd för **verksamhetsbaserad arkivredovisning** (processorienterad förteckning enligt RA-FS 2008:4) är inte implementerat. Detta beror på att:

1. Strukturen skiljer sig avsevärt från Allmänna Arkivschemat
2. Det saknas testdata från verkliga institutioner

Om du vill bidra till att lägga till stöd för verksamhetsbaserad redovisning välkomnas:

- **Utvecklingsbidrag** (pull requests) mot projektets repo
- **Exempelfiler** — VA7-exportfiler med verksamhetsbaserad redovisning som kan användas för att testa och utveckla importfunktionen

