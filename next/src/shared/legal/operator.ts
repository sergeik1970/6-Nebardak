/**
 * Operator details required by 152-ФЗ on the privacy and consent pages.
 * Values in square brackets are placeholders: fill them and have a lawyer
 * review both texts before accounts are enabled in production.
 */
export const LEGAL_OPERATOR = {
    name: "[ФИО индивидуального предпринимателя или наименование организации]",
    registration: "[ИНН и ОГРН / ОГРНИП]",
    address: "[почтовый адрес для обращений]",
    email: "[адрес электронной почты для обращений по персональным данным]",
    hosting: "[хостинг-провайдер и город размещения серверов в России]",
    mailProvider: "[почтовый сервис, отправляющий письма]",
    backupRetention: "[срок хранения резервных копий, например 30 дней]",
} as const;

export const hasLegalPlaceholders = (): boolean =>
    Object.values(LEGAL_OPERATOR).some((value) => value.startsWith("["));
