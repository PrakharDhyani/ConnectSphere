/**
 * Kafka Producer Configuration (KafkaJS)
 *
 * What is a Kafka Producer?
 *   A producer is the component that SENDS messages to Kafka topics.
 *   Think of it as a writer that drops messages into a queue.
 *
 * What is a Kafka Topic?
 *   A named channel (like a folder). Producers write to topics,
 *   consumers read from topics. Topics are persistent and replayable.
 *
 * Groot topics we'll create:
 *   - call.recording.chunks   → raw video/audio chunks from a call
 *   - call.events             → joined/left/started-recording events
 *   - notifications           → email/push notification triggers
 */

import { Kafka, Partitioners, logLevel } from "kafkajs";
import { logger } from "../utils/logger.js";

let kafkaProducer;

const kafka = new Kafka({
  clientId: process.env.KAFKA_CLIENT_ID || "connectsphere-backend",
  brokers: [process.env.KAFKA_BROKER || "localhost:9092"],
  logLevel: logLevel.WARN,  // suppress verbose Kafka internal logs
});

export async function connectKafka() {
  kafkaProducer = kafka.producer({
    createPartitioner: Partitioners.LegacyPartitioner,
  });

  await kafkaProducer.connect();
  logger.info("✅ Kafka producer connected");
}

/**
 * Send a message to a Kafka topic.
 *
 * @param {string} topic   - Topic name, e.g. "call.events"
 * @param {object} message - Plain JS object (will be JSON serialized)
 * @param {string} key     - Optional partition key (e.g. roomId keeps room events ordered)
 *
 * Example:
 *   await publishToKafka("call.events", { type: "USER_JOINED", roomId, userId });
 */
export async function publishToKafka(topic, message, key = null) {
  try {
    await kafkaProducer.send({
      topic,
      messages: [
        {
          key: key ? String(key) : null,
          value: JSON.stringify(message),
          timestamp: Date.now().toString(),
        },
      ],
    });
  } catch (err) {
    logger.error(`Kafka publish error on topic "${topic}":`, err);
    throw err;
  }
}

export { kafka, kafkaProducer };
