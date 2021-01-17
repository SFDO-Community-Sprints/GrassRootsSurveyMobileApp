import { fetchRetriable } from './connection';

import { ASYNC_STORAGE_KEYS } from '../../../constants';
import { logger } from '../../../utility/logger';
import { DescribeLayoutResult, DescribeLayout } from '../../../../src/types/metadata';
import { formatISOStringToAPIDate } from '../../../utility/date';

const SALESFORCE_API_VERSION = 'v49.0';

/**
 * @description Execute SOQL and return records
 * @param query SOQL
 * @return records
 */
export const fetchSalesforceRecords = async (query: string) => {
  const endPoint = (await buildEndpointUrl()) + `/query?q=${query}`;
  const response = await fetchRetriable(endPoint, 'GET', undefined);
  console.log(response);
  logger('FINE', 'fetchSalesforceRecords', response.records);
  const records = response.records.map(r => {
    delete r.attributes;
    return r;
  });
  return records;
};

/**
 * @description Create multiple records using composite resource.
 * @param records
 * @see https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/dome_composite_sobject_tree_flat.htm
 */
export const createSalesforceRecords = async (sObjectType: string, records) => {
  const endPoint = (await buildEndpointUrl()) + `/composite/tree/${sObjectType}`;
  const fieldType = await storage.load({ key: ASYNC_STORAGE_KEYS.FIELD_TYPE });
  const body = {
    records: records.map((r, index) => {
      Object.entries(r).forEach(([key, value]) => {
        // Remove null fields
        if (value === null) {
          delete r[key];
          // Replace number value to boolean for checkbox field
        } else if (fieldType[key] === 'boolean') {
          r[key] = value === 1 ? true : false;
        } else if (fieldType[key] === 'date') {
          r[key] = formatISOStringToAPIDate(value as string);
        }
      });
      r.attributes = {
        type: 'Survey__c',
        referenceId: `ref${index}`,
      };
      return r;
    }),
  };
  const response = await fetchRetriable(endPoint, 'POST', JSON.stringify(body));
  return response;
};

/**
 * Retrieve record type mappings information
 * @param sObjectType
 * @see https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/resources_sobject_layouts.htm
 */
export const describeLayoutResult = async (sObjectType: string): Promise<DescribeLayoutResult> => {
  const endPoint = (await buildEndpointUrl()) + `/sobjects/${sObjectType}/describe/layouts`;
  logger('DEBUG', 'describeLayoutResult', endPoint);

  const response = await fetchRetriable(endPoint, 'GET', undefined);
  return response;
};

/**
 * Retrieve page layout information
 * @param sObjectType
 * @param recordTypeId
 * @see https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/resources_sobject_layouts.htm
 */
export const describeLayout = async (sObjectType: string, recordTypeId: string): Promise<DescribeLayout> => {
  const endPoint =
    (await buildEndpointUrl()) + `/sobjects/${sObjectType}/describe/layouts/${recordTypeId ? recordTypeId : ''}`;
  logger('DEBUG', 'describeLayout', endPoint);

  const response = await fetchRetriable(endPoint, 'GET', undefined);
  return response;
};

const buildEndpointUrl = async () => {
  const instanceUrl = await storage.load({
    key: ASYNC_STORAGE_KEYS.SALESFORCE_INSTANCE_URL,
  });
  return `${instanceUrl}/services/data/${SALESFORCE_API_VERSION}`;
};