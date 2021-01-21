import { describeLayoutResult, describeLayout, fetchSalesforceRecords } from './core';
import { saveRecords } from '../database/database';

import {
  SQLiteRecordType,
  SQLitePageLayoutSection,
  SQLitePageLayoutItem,
  SQLitePicklistValue,
  SQLiteLocalization,
} from '../../types/sqlite';
import { DescribeLayoutResult, DescribeLayout, LocalizationCustomMetadata } from '../../types/metadata';

import { logger } from '../../utility/logger';
import { DB_TABLE, SURVEY_OBJECT, BACKGROUND_SURVEY_FIELDS } from '../../constants';

/**
 * @description Query record types by REST API (describe layouts) and save the results to local database.
 * Expect that at least one record type exists in the org.
 */
export const storeRecordTypes = async () => {
  const response: DescribeLayoutResult = await describeLayoutResult(SURVEY_OBJECT);
  const recordTypes: Array<SQLiteRecordType> = response.recordTypeMappings
    .filter(r => r.active && r.name !== 'Master')
    .map(r => ({
      name: r.developerName,
      label: r.name,
      recordTypeId: r.recordTypeId,
      layoutId: r.layoutId,
    }));
  if (recordTypes.length === 0) {
    return Promise.reject({ error: 'no_record_types' });
  }
  logger('DEBUG', 'storeRecordTypes', `${JSON.stringify(recordTypes)}`);
  await saveRecords(DB_TABLE.RECORD_TYPE, recordTypes, 'name');
  return recordTypes;
};

/**
 * @description Query layouts and fields including picklist values by Rest API (describe layout) and save the result to local database.
 * @param recordTypeId
 * @return serializedPicklistValueSet
 */
export const storePageLayoutItems = async (recordTypeId: string) => {
  const response: DescribeLayout = await describeLayout(SURVEY_OBJECT, recordTypeId);
  const pageLayoutSections: Array<SQLitePageLayoutSection> = response.editLayoutSections
    .filter(section => section.useHeading)
    .map(section => ({
      id: section.layoutSectionId,
      layoutId: section.parentLayoutId,
      sectionLabel: section.heading,
    }));
  logger('FINE', 'storePageLayoutItems | sections', pageLayoutSections);
  await saveRecords(DB_TABLE.PAGE_LAYOUT_SECTION, pageLayoutSections, 'id');

  const backgroundFields = BACKGROUND_SURVEY_FIELDS.map(f => f.fieldName);
  const serializedPicklistValueSet: Set<string> = new Set();
  const pageLayoutItems: Array<SQLitePageLayoutItem> = response.editLayoutSections
    .filter(section => section.useHeading)
    .map(section => {
      return section.layoutRows.map(row => {
        return row.layoutItems.map(item => {
          // Avoid adding empty space, read-only field, and user contact lookup field
          return item.layoutComponents
            .filter(
              c =>
                c.type !== 'EmptySpace' &&
                c.details.updateable &&
                (c.details.referenceTo.length === 0 || c.details.referenceTo[0] === 'Contact') &&
                !backgroundFields.includes(c.details.name)
            )
            .map(c => {
              if (c.details.type === 'picklist') {
                const values: Array<SQLitePicklistValue> = c.details.picklistValues
                  .filter(v => v.active)
                  .map(v => ({
                    fieldName: c.details.name,
                    label: v.label,
                    value: v.value,
                  }));
                values.forEach(v => {
                  serializedPicklistValueSet.add(JSON.stringify(v));
                });
              }
              return {
                sectionId: section.layoutSectionId,
                fieldName: c.details.name,
                fieldLabel: c.details.label,
                fieldType: c.details.type,
              };
            });
        });
      });
    })
    .flat(3);
  logger('DEBUG', 'storePageLayoutItems | items', pageLayoutItems);
  if (pageLayoutItems.length === 0) {
    return Promise.reject({ error: 'no_editable_fields' });
  }
  await saveRecords(DB_TABLE.PAGE_LAYOUT_ITEM, pageLayoutItems, undefined);

  const serializedFieldTypeSet = [
    ...pageLayoutItems.map(item => JSON.stringify({ name: item.fieldName, type: item.fieldType })),
  ];
  return { serializedPicklistValueSet, serializedFieldTypeSet };
};

/**
 * @description Retrieve Salesforce 'Localization__mdt' Custom Metadata records and save them to local database
 */
export const storeLocalization = async () => {
  const query =
    'SELECT GRMS_Type__c, GRMS_Locale__c, GRMS_OriginalName__c, GRMS_TranslatedLabel__c FROM GRMS_Localization__mdt';
  const records: Array<LocalizationCustomMetadata> = await fetchSalesforceRecords(query);
  if (records.length === 0) {
    return;
  }
  const localizations: Array<SQLiteLocalization> = records.map(r => {
    return {
      locale: r.GRMS_Locale__c,
      type: r.GRMS_Type__c,
      name: r.GRMS_OriginalName__c,
      label: r.GRMS_TranslatedLabel__c ? r.GRMS_TranslatedLabel__c.replace(/'/g, "''") : '', // escape single quote for sqlite
    };
  });
  await saveRecords(DB_TABLE.LOCALIZATION, localizations, undefined);
};
