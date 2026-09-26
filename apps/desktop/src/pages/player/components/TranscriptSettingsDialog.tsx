import React from "react";
import { useAtom } from "jotai";
import { z } from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  fontFamilyAtom,
  fontSizeAtom,
  translationTargetLangAtom,
  includeTranslationInNoteAtom,
  showInlineTranslationsAtom,
  showDualSubtitlesAtom,
  secondarySubtitleLangAtom,
} from "@/context/transcriptSettings";
import { logger } from "@/helpers/logger";
import { LEARNING_FEATURES_ENABLED } from "@/lib/features";

interface TranscriptSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filteredLanguages: Array<{ lang: string; hasManual: boolean; hasAuto: boolean }>;
  selectedLang: string | null;
  effectiveLang?: string;
  onLanguageChange: (lang: string) => void;
}

export function TranscriptSettingsDialog({
  open,
  onOpenChange,
  filteredLanguages,
  selectedLang,
  effectiveLang,
  onLanguageChange,
}: TranscriptSettingsDialogProps): React.JSX.Element {
  // Use atoms directly for settings
  const [fontFamily, setFontFamily] = useAtom(fontFamilyAtom);
  const [fontSize, setFontSize] = useAtom(fontSizeAtom);
  const [translationTargetLang, setTranslationTargetLang] = useAtom(translationTargetLangAtom);
  const [includeTranslationInNote, setIncludeTranslationInNote] = useAtom(
    includeTranslationInNoteAtom
  );
  const [showInlineTranslations, setShowInlineTranslations] = useAtom(showInlineTranslationsAtom);
  const [showDualSubtitles, setShowDualSubtitles] = useAtom(showDualSubtitlesAtom);
  const [secondaryLang, setSecondaryLang] = useAtom(secondarySubtitleLangAtom);

  // Zod schema for font family validation
  const fontFamilySchema = z.enum(["system", "serif", "mono"]);

  // Type-safe handler for font family changes
  const handleFontFamilyChange = (value: string): void => {
    const result = fontFamilySchema.safeParse(value);
    if (!result.success) {
      logger.error("[transcript-settings] Invalid font family value", {
        value,
        error: result.error,
      });
      return;
    }
    setFontFamily(result.data);
  };

  // Common translation target languages
  const translationLanguages = [
    { code: "vi", name: "Vietnamese (Tiếng Việt)" },
    { code: "en", name: "English" },
    { code: "es", name: "Spanish (Español)" },
    { code: "fr", name: "French (Français)" },
    { code: "de", name: "German (Deutsch)" },
    { code: "it", name: "Italian (Italiano)" },
    { code: "pt", name: "Portuguese (Português)" },
    { code: "ru", name: "Russian (Русский)" },
    { code: "ja", name: "Japanese (日本語)" },
    { code: "ko", name: "Korean (한국어)" },
    { code: "zh", name: "Chinese (中文)" },
    { code: "ar", name: "Arabic (العربية)" },
    { code: "hi", name: "Hindi (हिन्दी)" },
    { code: "th", name: "Thai (ไทย)" },
    { code: "id", name: "Indonesian (Bahasa Indonesia)" },
    { code: "nl", name: "Dutch (Nederlands)" },
    { code: "pl", name: "Polish (Polski)" },
    { code: "tr", name: "Turkish (Türkçe)" },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Transcript settings</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* Language Selector */}
          {filteredLanguages.length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs">Language</Label>
              <Select value={selectedLang ?? effectiveLang ?? ""} onValueChange={onLanguageChange}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Select language" />
                </SelectTrigger>
                <SelectContent>
                  {filteredLanguages.map((l) => (
                    <SelectItem key={l.lang} value={l.lang}>
                      {l.lang}
                      {l.hasManual ? "" : " (auto)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Font family */}
          <div className="space-y-2">
            <Label className="text-xs">Font family</Label>
            <Select value={fontFamily} onValueChange={handleFontFamilyChange}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="system">System (Default)</SelectItem>
                <SelectItem value="serif">Serif</SelectItem>
                <SelectItem value="mono">Monospace</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Font size */}
          <div className="space-y-2">
            <Label className="text-xs">Font size</Label>
            <Select value={String(fontSize)} onValueChange={(v) => setFontSize(Number(v))}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[12, 14, 16, 18, 20, 22, 24].map((s) => (
                  <SelectItem key={s} value={String(s)}>
                    {s}px
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Translation Target Language */}
          <div className="space-y-2">
            <Label className="text-xs">Translation target language</Label>
            <Select value={translationTargetLang} onValueChange={setTranslationTargetLang}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {translationLanguages.map((lang) => (
                  <SelectItem key={lang.code} value={lang.code}>
                    {lang.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Selected text will be translated to this language
            </p>
          </div>

          {/* Include Translation in Note */}
          <div className="flex items-center space-x-2">
            <Checkbox
              id="include-translation-setting"
              checked={includeTranslationInNote}
              onCheckedChange={(checked) => setIncludeTranslationInNote(checked === true)}
            />
            <Label htmlFor="include-translation-setting" className="cursor-pointer text-xs">
              Auto-include translation in note (default)
            </Label>
          </div>

          {/* Show Inline Translations */}
          {LEARNING_FEATURES_ENABLED && (
            <div className="flex items-center space-x-2">
              <Checkbox
                id="show-inline-translations"
                checked={showInlineTranslations}
                onCheckedChange={(checked) => setShowInlineTranslations(checked === true)}
              />
              <Label htmlFor="show-inline-translations" className="cursor-pointer text-xs">
                Show saved word translations inline
              </Label>
            </div>
          )}

          <div className="my-2 h-px bg-border" />

          {/* Dual Subtitles Settings */}
          <div className="space-y-4">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="show-dual-subtitles"
                checked={showDualSubtitles}
                onCheckedChange={(checked) => setShowDualSubtitles(checked === true)}
              />
              <Label htmlFor="show-dual-subtitles" className="cursor-pointer text-xs font-semibold">
                Show Dual Subtitles (Enhanced Learning)
              </Label>
            </div>

            {showDualSubtitles && (
              <div className="space-y-2 pl-6">
                <Label className="text-xs">Secondary Language</Label>
                <Select value={secondaryLang} onValueChange={setSecondaryLang}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {translationLanguages.map((lang) => (
                      <SelectItem key={lang.code} value={lang.code}>
                        {lang.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Will use YouTube subtitles if available, otherwise auto-translate.
                </p>
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
