import type { AppLocale } from "@packages/locales";
import {
  renderWeeklyFamilyHighlightsTemplate,
  type WeeklyFamilyHighlightsTemplateProps,
} from "@/lib/email/templates/weekly-family-highlights";

export type EmailTemplateId = "weekly-family-highlights";

export type RenderedEmailTemplate = {
  templateId: EmailTemplateId;
  subject: string;
  html: string;
  text: string;
};

export function renderEmailTemplate(input: {
  templateId: "weekly-family-highlights";
  locale: AppLocale;
  familyLocale?: AppLocale | null;
  props: WeeklyFamilyHighlightsTemplateProps;
}): RenderedEmailTemplate {
  if (input.templateId === "weekly-family-highlights") {
    return {
      templateId: input.templateId,
      ...renderWeeklyFamilyHighlightsTemplate({
        locale: input.locale,
        familyLocale: input.familyLocale,
        props: input.props,
      }),
    };
  }
  throw new Error(`EMAIL_TEMPLATE_UNSUPPORTED_${input.templateId satisfies never}`);
}

export type { WeeklyFamilyHighlightsTemplateProps } from "@/lib/email/templates/weekly-family-highlights";
