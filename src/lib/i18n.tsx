import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Lang = "en" | "mk";

const STORAGE_KEY = "volttrade-lang";

/** Macedonian overrides keyed by the English source string. */
const MK: Record<string, string> = {
  // ── App chrome ──
  "Dashboard": "Контролна табла",
  "Sign out": "Одјава",
  "Sign in": "Најава",
  "Settings": "Поставки",
  "Loading…": "Се вчитува…",
  "Open menu": "Отвори мени",
  "View as customer": "Прегледај како клиент",
  "Switch to light": "Премини на светла тема",
  "Switch to dark": "Премини на темна тема",
  "Language": "Јазик",

  // ── ERP sidebar groups ──
  "Management": "Менаџмент",
  "Supply": "Снабдување",
  "Trading": "Тргување",
  "Risk": "Ризик",
  "Planning": "Планирање",
  "Assets": "Средства",
  "Balancing & Settlement": "Балансирање и порамнување",
  "Supply Operations": "Оперативи за снабдување",
  "Admin": "Администрација",

  // ── ERP sidebar items ──
  "Customers": "Клиенти",
  "Supply Points": "Мерни места",
  "Tariffs": "Тарифи",
  "Supply Contracts": "Договори за снабдување",
  "PPA Agreements": "PPA договори",
  "Meter Readings": "Отчити",
  "Reconciliation": "Усогласување",
  "Billing Runs": "Пресметки",
  "Invoices": "Фактури",
  "Payments": "Плаќања",
  "Market Prices": "Пазарни цени",
  "Counterparties": "Договорни страни",
  "Trading Contracts": "Договори за тргување",
  "Trade Blotter": "Дневник на трговии",
  "Schedules": "Распореди",
  "Risk & Exposure": "Ризик и изложеност",
  "Hourly Position": "Часовна позиција",
  "Forecasting": "Прогнозирање",
  "Sites & Assets": "Локации и средства",
  "BESS Optimizer": "BESS оптимизатор",
  "Monitoring": "Мониторинг",
  "PV Plants": "Фотоволтаици",
  "Smart Meter": "Паметно броило",
  "Gateways (Kimi)": "Гејтвеи (Kimi)",
  "Consumer Manager": "Менаџер на потрошувачи",
  "SLP Synthesis": "SLP синтеза",
  "Scheduling": "Најави и распоред",
  "Live Position": "Тековна позиција",
  "Imbalance Settlement": "Порамнување на отстапувања",
  "Imbalance Allocation": "Распределба на отстапувања",
  "Forecast Accuracy": "Точност на прогноза",
  "Data Readiness": "Подготвеност на податоци",
  "Smart Meter Health": "Состојба на паметни броила",
  "Regulatory Deadlines": "Регулаторни рокови",
  "Onboarding / KYC": "Прием на клиенти / KYC",
  "Switching": "Промена на снабдувач",
  "Users & Roles": "Корисници и улоги",
  "Audit Log": "Дневник на промени",
  "Sync Health": "Состојба на синхронизации",
  "Portal Access": "Пристап до портал",
  "Vatra Applications": "Vatra апликации",

  // ── Portal navigation ──
  "Home": "Дома",
  "Consumption": "Потрошувачка",
  "Profile": "Профил",
  "My supply points": "Мои мерни места",
  "Savings": "Заштеди",
  "EV charging": "ЕВ полнење",
  "Refer": "Препорачај",
  "My PPA": "Мои PPA",
  "Submit reading": "Внеси отчит",
  "Notifications": "Известувања",
  "More": "Повеќе",
  "Your energy": "Твојата енергија",

  // ── Portal page titles ──
  "Welcome": "Добредојде",
  "Hourly readings": "Часовни отчити",
  "My PPA agreements": "Мои PPA договори",
  "Refer a friend": "Препорачај пријател",
  "Tariffs & prices": "Тарифи и цени",
  "Saving Sessions": "Сесии за заштеда",
  "Submit meter reading": "Внеси отчит",
  "EV smart charging": "Паметно полнење на ЕВ",
  "Add your EV": "Додај го твоето возило",
  "Not linked.": "Не е поврзано.",
};

const DICTS: Record<Lang, Record<string, string>> = { en: {}, mk: MK };

interface I18nContextType {
  lang: Lang;
  setLang: (l: Lang) => void;
  toggleLang: () => void;
  /** Translate an English source string; falls back to the source. */
  t: (s: string) => string;
}

const I18nContext = createContext<I18nContextType | undefined>(undefined);

function getInitialLang(): Lang {
  if (typeof window === "undefined") return "en";
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "en" || stored === "mk") return stored;
    if (navigator.language?.toLowerCase().startsWith("mk")) return "mk";
  } catch {
    // ignore storage errors
  }
  return "en";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => getInitialLang());

  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, lang); } catch { /* ignore */ }
    document.documentElement.lang = lang;
  }, [lang]);

  const value: I18nContextType = {
    lang,
    setLang: setLangState,
    toggleLang: () => setLangState(p => (p === "en" ? "mk" : "en")),
    t: (s: string) => DICTS[lang][s] ?? s,
  };
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) return { lang: "en" as Lang, setLang: () => {}, toggleLang: () => {}, t: (s: string) => s };
  return ctx;
}
