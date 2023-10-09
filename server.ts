// Copyright 2021-2023 IOTA Stiftung
// SPDX-License-Identifier: Apache-2.0

import {
  Block,
  Transaction,
  Client,
  initLogger,
  MilestonePayload,
  parsePayload,
  AddressUnlockCondition,
  RegularTransactionEssence,
  BasicOutput,
  UTXOInput,
  TransactionPayload,
  TaggedDataPayload,
  Input,
  Output,
} from '@iota/sdk'
import { plainToInstance } from 'class-transformer'

require('dotenv').config({ path: '.env' })

// Run with command:
// yarn run-example ./client/10-mqtt.ts

// In this example we will listen to MQTT topics and print the block and milestone payloads.

const processInputs = async (inputs: Input[], client: Client) => {
  return await Promise.all(
    inputs.map(async (input) => {
      if (!(input instanceof UTXOInput)) return undefined
      const output = await getBlockOutput(input, client)
      if (!output) return undefined
      return formatOutput(true)(output)
    })
  )
}

const getBlockOutput = async (input: UTXOInput, client: Client) => {
  const block = await client.getIncludedBlock(input.transactionId)
  if (!(block.payload instanceof TransactionPayload)) {
    return undefined
  }
  const { essence } = block.payload
  if (!(essence instanceof RegularTransactionEssence)) {
    return undefined
  }
  return essence.outputs[input.transactionOutputIndex]
}

const formatOutput = (isFromSide: boolean) => (output: Output) => {
  if (!(output instanceof BasicOutput)) return undefined
  return {
    amount: output.amount,
    ...(isFromSide && {
      from: output.unlockConditions
        .filter((condition) => condition instanceof AddressUnlockCondition)
        .map((condition) =>
          (condition as AddressUnlockCondition).address.toString()
        ),
    }),
    ...(!isFromSide && {
      to: output.unlockConditions
        .filter((condition) => condition instanceof AddressUnlockCondition)
        .map((condition) =>
          (condition as AddressUnlockCondition).address.toString()
        ),
    }),
  }
}

const processOutputs = (outputs: Output[]) => {
  return outputs.map(formatOutput(false))
}

async function run() {
  initLogger()
  if (!process.env.NODE_URL) {
    throw new Error('.env NODE_URL is undefined, see .env.example')
  }

  // Connecting to a MQTT broker using raw ip doesn't work with TCP. This is a limitation of rustls.
  const client = new Client({
    // Insert your node URL in the .env.
    nodes: [process.env.NODE_URL],
  })

  const tag = Buffer.from('mosquitopay:test1.local').toString('hex')
  console.log(tag)
  // Array of topics to subscribe to
  // Topics can be found here https://studio.asyncapi.com/?url=https://raw.githubusercontent.com/iotaledger/tips/main/tips/TIP-0028/event-api.yml
  const topics = [`blocks/transaction/tagged-data/0x${tag}`]

  const callback = async function (error: Error, data: string) {
    if (error != null) {
      console.log(error)
      return
    }

    const parsed = JSON.parse(data)
    console.log(parsed.topic)
    if (parsed.topic == 'milestone') {
      const payload = parsePayload(
        JSON.parse(parsed.payload)
      ) as MilestonePayload
      const index = payload.index
      const previousMilestone = payload.previousMilestoneId
      console.log(
        'New milestone index' + index + ', previous ID: ' + previousMilestone
      )
    } else if (parsed.topic == `blocks/transaction/tagged-data/0x${tag}`) {
      const payload = plainToInstance(Transaction, JSON.parse(parsed.payload))
      if (payload.payload.essence instanceof RegularTransactionEssence) {
        console.log(
          'tag:',
          (payload.payload.essence.payload as TaggedDataPayload).tag
        )

        const inputs = await processInputs(
          payload.payload.essence.inputs,
          client
        )
        console.log('inputs:', inputs)

        const outputs = processOutputs(payload.payload.essence.outputs)
        console.log('outputs:', outputs)
      }
    }
  }

  await client.listenMqtt(topics, callback)

  // Clear listener after 10 seconds
  clearMqttListenersAfterDelay(client, topics, 100000)
}

function clearMqttListenersAfterDelay(
  client: Client,
  topics: string[],
  delay: number
) {
  setTimeout(async () => {
    await client.clearMqttListeners(topics)
    console.log('Listener cleared')
    process.exit(0)
  }, delay)
}

run()
