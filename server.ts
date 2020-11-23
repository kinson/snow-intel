import * as Hapi from "@hapi/hapi";
import * as B from "bluebird";
import { addDays, format, formatISO } from "date-fns";
import * as Twilio from "twilio";

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

const fileName = "./numbers.json";
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

function sendMessage(h, sub?: Subscription) {
  const twiml = new Twilio.twiml.MessagingResponse();

  const welcomeMessage =
    "You are all set, we will keep you up to date on any road closures for the next day. Check exiting conditions here: cotrip.org/travelAlerts.htm";

  const dupeMessage = `You are already signed up until ${
    sub && format(new Date(sub.expiration), "M/d 'at' h:mm aaaa")
  }, we will notify you with any road closures.`;

  twiml.message(sub ? dupeMessage : welcomeMessage);

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

      if (!users) {
        console.log("creating users file");
        await writeToJSONFile([
          {
            number: body.From,
            expiration: addDays(new Date(), 1).toISOString(),
          },
        ]);

        return sendMessage(h);
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

        return sendMessage(h);
      }

      // if user is not registered, add them and let them know
      return sendMessage(h, existingSubscription);
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
