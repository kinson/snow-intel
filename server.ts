import * as Hapi from "@hapi/hapi";
import * as B from "bluebird";
import { addDays, formatISO } from "date-fns";
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

const init = async () => {
  const server = Hapi.server({
    port: 3000,
    host: "localhost",
  });

  server.route({
    method: "POST",
    path: "/register",
    handler: async (request, h) => {
      console.log(request.headers);
      console.log(request.payload);
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

        const twiml = new Twilio.twiml.MessagingResponse();

        twiml.message("The Robots are coming! Head for the hills!");

        const response = h.response(twiml.toString());
        response.type("text/xml");
        return response;
      }

      const userIsRegistered = users.findIndex((u) => u.number === body.From);
      // if user is registered, let them know
      if (userIsRegistered === -1) {
        console.log(
          `${formatISO(new Date())}: adding user to file - total: ${
            users.length + 1
          }`
        );

        await writeToJSONFile([
          ...users,
          {
            number: body.From,
            expiration: addDays(new Date(), 1).toISOString(),
          },
        ]);

        const twiml = new Twilio.twiml.MessagingResponse();

        twiml.message("The Robots are coming! Head for the hills!");

        const response = h.response(twiml.toString());
        response.type("text/xml");
        return response;
      }

      // if user is not registered, add them and let them know
      const twiml = new Twilio.twiml.MessagingResponse();
      twiml.message(
        "You are already signed up, we will notify you with any road closures."
      );

      const response = h.response(twiml.toString());
      response.type("text/xml");
      return response;
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
