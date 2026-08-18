import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Languages } from "lucide-react";

/** Compact EN/MK switcher used in both the ERP and portal headers. */
export function LanguageToggle({ className = "" }: { className?: string }) {
  const { lang, toggleLang, t } = useI18n();
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={toggleLang}
      aria-label={t("Language")}
      title={t("Language")}
      className={`px-2 gap-1.5 ${className}`}
    >
      <Languages className="h-4 w-4" />
      <span className="text-xs font-medium tracking-wide">{lang === "en" ? "EN" : "МК"}</span>
    </Button>
  );
}
