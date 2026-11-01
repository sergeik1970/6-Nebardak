/**
 * Operator details required by 152-ФЗ on the privacy and consent pages.
 * Values in square brackets are placeholders: fill them and have a lawyer
 * review the texts. The offline duties that go with them (notice to
 * Roskomnadzor, internal acts) are listed in docs/legal-compliance.md.
 */
export const LEGAL_OPERATOR = {
    name: "[ФИО индивидуального предпринимателя или наименование организации]",
    registration: "ИНН 440122104148",
    address: "[почтовый адрес для обращений]",
    responsible: "[ФИО ответственного за организацию обработки персональных данных]",
    email: "contact@stylefinder.online",
    hosting: "[хостинг-провайдер и город размещения серверов в России]",
    mailProvider: "ООО «Регистратор доменных имён РЕГ.РУ» (почтовый хостинг Reg.ru)",
    backupStorage: "ООО «Регистратор доменных имён РЕГ.РУ» (облачное хранилище Reg.ru S3, Москва)",
    backupRetention: "30 дней",
} as const;

export const hasLegalPlaceholders = (): boolean =>
    Object.values(LEGAL_OPERATOR).some((value) => value.startsWith("["));
