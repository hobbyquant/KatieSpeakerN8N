import type {
	IExecuteFunctions,
	IHttpRequestOptions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

export class KatieSpeaker implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Katie Speaker',
		name: 'katieSpeaker',
		icon: 'file:katiespeaker.svg',
		group: ['output'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Publish spoken notifications to Katie Speaker devices',
		defaults: {
			name: 'Katie Speaker',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [
			{
				name: 'katieSpeakerApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Publish Message',
						value: 'publish',
						description: 'Publish a message to your Katie Speaker channel',
						action: 'Publish a message',
					},
					{
						name: 'Broadcast Message',
						value: 'broadcast',
						description:
							'Broadcast a message to all subscribers, bypassing their filters',
						action: 'Broadcast a message',
					},
					{
						name: 'Get Subscriber Filters',
						value: 'getFilters',
						description: 'Get aggregated subscription filter rules for your channel',
						action: 'Get subscriber filters',
					},
					{
						name: 'Should Publish',
						value: 'shouldPublish',
						description:
							'Check if any subscriber would receive a message with the given metadata',
						action: 'Check if should publish',
					},
				],
				default: 'publish',
			},

			// ------ Message field (publish & broadcast) ------
			{
				displayName: 'Message',
				name: 'message',
				type: 'string',
				typeOptions: {
					rows: 4,
				},
				default: '',
				required: true,
				displayOptions: {
					show: {
						operation: ['publish', 'broadcast'],
					},
				},
				description: 'The text message to be spoken aloud and displayed on the device',
			},

			// ------ Optional fields (publish & broadcast) ------
			{
				displayName: 'Additional Fields',
				name: 'additionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: {
					show: {
						operation: ['publish', 'broadcast'],
					},
				},
				options: [
					{
						displayName: 'TTS Override',
						name: 'messageTts',
						type: 'string',
						typeOptions: {
							rows: 3,
						},
						default: '',
						description:
							'Alternate text optimized for text-to-speech. If set, this is spoken while the main message is displayed.',
					},
					{
						displayName: 'TTL (Seconds)',
						name: 'ttlSeconds',
						type: 'number',
						default: 0,
						description:
							'Time-to-live in seconds. The message expires after this duration. Set to 0 for no expiration.',
					},
					{
						displayName: 'Metadata',
						name: 'meta',
						type: 'fixedCollection',
						typeOptions: {
							multipleValues: true,
						},
						default: {},
						description:
							'Key-value metadata attached to the message. Subscribers can filter based on these fields.',
						options: [
							{
								displayName: 'Entries',
								name: 'entries',
								values: [
									{
										displayName: 'Key',
										name: 'key',
										type: 'string',
										default: '',
										description: 'The metadata field name',
									},
									{
										displayName: 'Value',
										name: 'value',
										type: 'string',
										default: '',
										description: 'The metadata field value',
									},
								],
							},
						],
					},
				],
			},

			// ------ Metadata for shouldPublish ------
			{
				displayName: 'Metadata',
				name: 'meta',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: true,
				},
				default: {},
				displayOptions: {
					show: {
						operation: ['shouldPublish'],
					},
				},
				description:
					'Key-value metadata to check against subscriber filters. Returns whether any subscriber would receive a message with this metadata.',
				options: [
					{
						displayName: 'Entries',
						name: 'entries',
						values: [
							{
								displayName: 'Key',
								name: 'key',
								type: 'string',
								default: '',
								description: 'The metadata field name',
							},
							{
								displayName: 'Value',
								name: 'value',
								type: 'string',
								default: '',
								description: 'The metadata field value',
							},
						],
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		const credentials = await this.getCredentials('katieSpeakerApi');
		const baseUrl = credentials.baseUrl as string;
		const channelApiKey = credentials.channelApiKey as string;

		const operation = this.getNodeParameter('operation', 0) as string;

		for (let i = 0; i < items.length; i++) {
			try {
				if (operation === 'publish' || operation === 'broadcast') {
					const message = this.getNodeParameter('message', i) as string;
					const additionalFields = this.getNodeParameter('additionalFields', i) as {
						messageTts?: string;
						ttlSeconds?: number;
						meta?: { entries?: Array<{ key: string; value: string }> };
					};

					const body: Record<string, unknown> = {
						channel_apikey: channelApiKey,
						message,
					};

					if (additionalFields.messageTts) {
						body.message_tts = additionalFields.messageTts;
					}

					if (additionalFields.ttlSeconds && additionalFields.ttlSeconds > 0) {
						body.ttl_seconds = additionalFields.ttlSeconds;
					}

					const metaObj: Record<string, unknown> = {};
					if (additionalFields.meta?.entries) {
						for (const entry of additionalFields.meta.entries) {
							if (entry.key) {
								metaObj[entry.key] = entry.value;
							}
						}
					}

					if (operation === 'broadcast') {
						metaObj.broadcast = true;
					}

					if (Object.keys(metaObj).length > 0) {
						body.meta = metaObj;
					}

					const options: IHttpRequestOptions = {
						method: 'POST',
						url: `${baseUrl}/v1/messaging/publish`,
						body,
						json: true,
					};

					const response = await this.helpers.httpRequest(options);
					returnData.push({ json: response as INodeExecutionData['json'], pairedItem: i });
				} else if (operation === 'getFilters') {
					const options: IHttpRequestOptions = {
						method: 'GET',
						url: `${baseUrl}/v1/messaging/subscriber-filters`,
						qs: {
							channel_apikey: channelApiKey,
						},
					};

					const response = await this.helpers.httpRequest(options);
					returnData.push({ json: response as INodeExecutionData['json'], pairedItem: i });
				} else if (operation === 'shouldPublish') {
					const metaParam = this.getNodeParameter('meta', i) as {
						entries?: Array<{ key: string; value: string }>;
					};
					const meta: Record<string, unknown> = {};
					if (metaParam?.entries) {
						for (const entry of metaParam.entries) {
							if (entry.key) {
								meta[entry.key] = entry.value;
							}
						}
					}

					// Fetch subscriber filters
					const filtersOptions: IHttpRequestOptions = {
						method: 'GET',
						url: `${baseUrl}/v1/messaging/subscriber-filters`,
						qs: {
							channel_apikey: channelApiKey,
						},
					};

					const filtersResponse = (await this.helpers.httpRequest(filtersOptions)) as {
						has_unfiltered_subscribers: boolean;
						filters: Array<{ field: string; op: string; value: unknown }>;
					};

					// If there are unfiltered subscribers, always publish
					if (filtersResponse.has_unfiltered_subscribers) {
						returnData.push({
							json: { shouldPublish: true, reason: 'Unfiltered subscribers exist' },
							pairedItem: i,
						});
						continue;
					}

					// Evaluate filters locally
					const shouldPublish = evaluateFilters(filtersResponse.filters, meta);

					returnData.push({
						json: {
							shouldPublish,
							reason: shouldPublish
								? 'Message matches subscriber filters'
								: 'No subscribers would receive this message',
							subscriberFilters: filtersResponse.filters,
						},
						pairedItem: i,
					});
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: i,
					});
					continue;
				}
				throw error;
			}
		}

		return [returnData];
	}
}

function evaluateFilters(
	filters: Array<{ field: string; op: string; value: unknown }>,
	meta: Record<string, unknown>,
): boolean {
	if (!filters || filters.length === 0) {
		return false;
	}

	for (const filter of filters) {
		const metaValue = meta[filter.field];

		switch (filter.op) {
			case 'eq':
				if (metaValue === filter.value) return true;
				break;
			case 'ne':
				if (metaValue !== filter.value) return true;
				break;
			case 'gt':
				if (typeof metaValue === 'number' && metaValue > (filter.value as number)) return true;
				break;
			case 'gte':
				if (typeof metaValue === 'number' && metaValue >= (filter.value as number))
					return true;
				break;
			case 'lt':
				if (typeof metaValue === 'number' && metaValue < (filter.value as number)) return true;
				break;
			case 'lte':
				if (typeof metaValue === 'number' && metaValue <= (filter.value as number))
					return true;
				break;
			case 'in':
				if (Array.isArray(filter.value) && filter.value.includes(metaValue)) return true;
				break;
			case 'contains':
				if (typeof metaValue === 'string' && typeof filter.value === 'string') {
					if (metaValue.includes(filter.value)) return true;
				}
				break;
			default:
				break;
		}
	}

	return false;
}
