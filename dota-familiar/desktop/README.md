# ReplayFace Desktop (одно приложение)

Один запуск — без Overwolf.

## Что умеет без Overwolf
- Connect / familiar index (OpenDota)
- Авто-подхват **законченных** матчей
- Live lobby через **вставку ID врагов** (Valve не отдаёт чужие Steam ID легальным сторонним клиентам в ранкеде так, как хотелось бы)
- Опционально: GSI cfg (факт «матч начался»)

## Почему не «как DotaPlus без Overwolf»
Полный live-ростер с Steam ID после пиков Valve отдаёт через **Overwolf GEP** (или запрещённый memory-read). Свой легальный клиент **не может** честно заменить Overwolf для авто-ID врагов. Поэтому ReplayFace — один exe/окно для всего остального; Overwolf не нужен.

## Запуск (Windows)
```bat
desktop\start-desktop.bat
```
Нужен только **Node.js LTS** (один раз). Overwolf — нет.

Меню приложения: **Install Dota GSI cfg**.
