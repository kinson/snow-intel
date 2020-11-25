import * as Hapi from "@hapi/hapi";
import * as B from "bluebird";
import { addDays, format, formatISO, getTime, subHours } from "date-fns";
import * as Twilio from "twilio";
import * as crypto from "crypto";

const readFileAsync: (
  name: string,
  encoding: string
  // eslint-disable-next-line @typescript-eslint/no-var-requires
) => Promise<any> = B.promisify(require("fs").readFile);
const writeFileAsync: (
  name: string,
  contents: string,
  encoding: string
  // eslint-disable-next-line @typescript-eslint/no-var-requires
) => Promise<any> = B.promisify(require("fs").writeFile);

interface TwilioBody {
  From: string;
  SmsMessageSid: string;
  NumMedia: string;
  ToCity: string;
  FromZip: string;
  SmsSid: string;
  FromState: string;
  SmsStatus: string;
  FromCity: string;
  Body: string;
  FromCountry: string;
  To: string;
  ToZip: string;
  NumSegments: string;
  MessageSid: string;
  AccountSid: string;
  ApiVersion: string;
}

interface Subscription {
  number: string;
  expiration: string;
}

const STOP_STRINGS = [
  "STOP",
  "STOPALL",
  "UNSUBSCRIBE",
  "CANCEL",
  "END",
  "QUIT",
];

const denverTzOffset = 7;
const fileName = "./numbers.json";
const analyticsDirectory = "./analytics";

function readJSONFile(): Promise<Subscription[] | null> {
  return readFileAsync(fileName, "utf8")
    .then(JSON.parse)
    .catch(() => {
      return null;
    });
}

function writeToJSONFile(updatedSubscriptions: Subscription[]): Promise<any> {
  return writeFileAsync(fileName, JSON.stringify(updatedSubscriptions), "utf8");
}

function unsubscribeNumber(number: string, users?: Subscription[]) {
  if (!users) return;
  const filteredSubscriptions = users.filter((u) => u.number !== number);
  return writeToJSONFile(filteredSubscriptions);
}

function saveAnalytics(number: string, action: string, payload): Promise<any> {
  const hashedNumber = crypto.createHash("md5").update(number).digest("hex");
  const time = getTime(new Date());

  const fileName = `${analyticsDirectory}/${time}.json`;
  const contents = JSON.stringify({
    subscriptionHash: hashedNumber,
    action,
    payload: payload || null,
  });

  return writeFileAsync(fileName, contents, "utf8");
}

async function sendMessage(
  h,
  number: string,
  sub?: Subscription,
  unsub = false
) {
  const twiml = new Twilio.twiml.MessagingResponse();

  if (sub) {
    const formattedExpiration = format(
      subHours(new Date(sub.expiration), denverTzOffset),
      "M/d 'at' h:mm aaaa"
    );

    const message = `You are already signed up until ${formattedExpiration}, we will notify you with any road closures.`;

    twiml.message(message);
    await saveAnalytics(number, "DUPLICATE_SIGNUP", message);
  } else if (unsub) {
    const message =
      'You have been unsubscribed from road closure notifications. If you would like to join again reply with "START"';
    twiml.message(message);
    await saveAnalytics(number, "UNSUBSCRIBE", message);
  } else {
    const message =
      "You are all set, we will keep you up to date on any road closures for the next day. Check existing conditions here: cotrip.org/travelAlerts.htm";
    twiml.message(message);
    await saveAnalytics(number, "SIGNUP", message);
  }

  const response = h.response(twiml.toString());
  response.type("text/xml");
  return response;
}

const init = async () => {
  const server = Hapi.server({
    port: 3000,
    host: "localhost",
  });

  server.route({
    method: "POST",
    path: "/register",
    handler: async (request, h) => {
      const body: TwilioBody = request.payload;

      // check to see if user is registered
      const users = await readJSONFile();

      // if the user wants to stop, remove them from the file if it exists
      if (STOP_STRINGS.includes(body.Body.toUpperCase())) {
        await unsubscribeNumber(body.From, users);
        return sendMessage(h, body.From, undefined, true);
      }

      if (!users) {
        console.log("creating users file");
        await writeToJSONFile([
          {
            number: body.From,
            expiration: addDays(new Date(), 1).toISOString(),
          },
        ]);

        return sendMessage(h, body.From);
      }

      const existingSubscription = users.find((u) => u.number === body.From);
      // if user is registered, let them know
      if (!existingSubscription) {
        const expiration = addDays(new Date(), 1).toISOString();
        console.log(
          `${formatISO(new Date())}: adding user until ${expiration} - total: ${
            users.length + 1
          }`
        );

        await writeToJSONFile([
          ...users,
          {
            number: body.From,
            expiration,
          },
        ]);

        return sendMessage(h, body.From);
      }

      // if user is not registered, add them and let them know
      return sendMessage(h, body.From, existingSubscription);
    },
  });

  await server.start();
  console.log("Server running on %s", server.info.uri);
};

process.on("unhandledRejection", (err) => {
  console.log(err);
  process.exit(1);
});

init();
