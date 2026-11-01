// Portable contract: clients ask their connected server for its dashboard URL.
export const Dashboard = {
  id: 'vibetrace.dashboard',
  methods: {
    status: {
      input: { type: 'object', additionalProperties: false },
      output: { type: 'object', properties: { url: { type: ['string', 'null'] } }, required: ['url'], additionalProperties: false },
    },
  },
  events: {},
}
