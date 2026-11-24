# meridio (app)

React + TypeScript + Vite implementation of `project/Job Board v2.dc.html`.

    npm install
    npm run dev      # http://localhost:5173
    npm run build

- `src/i18n.ts`: ES/PT/EN strings, copied verbatim from the design.
- `src/data.ts`: sample jobs. Replace with a real API.
- `src/App.tsx`: list, detail, filter sheet, alert dialog, saved view.
- Filters are mirrored into the URL query string (`q`, `role`, `sen`, `country`, `posted`).
- Alert creation is a stub (`onSubmit` in `App.tsx`); it needs a backend with double opt-in.
