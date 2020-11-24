// eslint-disable-next-line @typescript-eslint/no-var-requires
require("dotenv").config();
import Axios from "axios";
import * as B from "bluebird";
import * as Cron from "cron";
import * as fs from "fs";
import * as Twilio from "twilio";
import { isFuture } from "date-fns";

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

interface Location {
  Latitude: string;
  Longitude: string;
}

interface AlertObject {
  AlertId: string;
  AlertIcon: string;
  Description: string;
  Direction: string;
  EndMileMarker?: string;
  Headline: string;
  Impact: string;
  IsBothDirectionFlg: string;
  LastUpdatedDate: string;
  Location?: Location;
  LocationDescription: string;
  RoadId: string;
  RoadName: string;
  RoadwayClosure: string;
  RoadwayClosureId: string;
  ReportedTime: string;
  StartMileMarker: string;
  Title: string;
  Type: string;
  TypeId: string;
}

interface AlertsResponse {
  Alerts: {
    Alert: AlertObject[];
  };
}

async function getTrafficData(): Promise<AlertObject[]> {
  const closuresData = await Axios.get<AlertsResponse>(
    "https://www.cotrip.org/roadConditions/getLaneClosureAlerts.do"
  );
  return closuresData.data.Alerts.Alert;
}

const roadDataFileName = "./roaddata.json";
const subscriptionsFileName = "./numbers.json";
const archiveDirectory = "./archive";

interface Subscription {
  number: string;
  expiration: string;
}

function readSubscriptionsFile(): Promise<Subscription[] | null> {
  return readFileAsync(subscriptionsFileName, "utf8")
    .then(JSON.parse)
    .catch(() => {
      return null;
    });
}

function readJSONFile(): Promise<AlertObject[] | null> {
  return readFileAsync(roadDataFileName, "utf8")
    .then(JSON.parse)
    .catch(() => {
      return null;
    });
}

function sendMessages(
  messages: string[],
  users?: Subscription[]
): Promise<any> {
  if (!users || users.length === 0) return;
  const client = Twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );
  return B.all(
    messages.reduce((acc, m) => {
      return [
        ...acc,
        ...users.map((u) =>
          client.messages.create({
            body: m,
            from: "+14342267669",
            to: u.number,
          })
        ),
      ];
    }, [])
  ).catch((err) => {
    console.error("Caught an error trying to send a message", err);
  });
}

function writeToNumbersFile(
  updatedSubscriptions: Subscription[]
): Promise<any> {
  return writeFileAsync(
    subscriptionsFileName,
    JSON.stringify(updatedSubscriptions),
    "utf8"
  );
}

function writeToJSONFile(
  updatedClosures: AlertObject[],
  savedClosures?: AlertObject[]
): Promise<any> {
  return writeFileAsync(
    roadDataFileName,
    JSON.stringify(updatedClosures),
    "utf8"
  ).then(() => {
    if (savedClosures) {
      const timeStamp = new Date().toISOString();
      return writeFileAsync(
        `${archiveDirectory}/${timeStamp}-road-closures.json`,
        JSON.stringify(updatedClosures),
        "utf8"
      );
    }
  });
}

function filterOpenings(closure: AlertObject) {
  const northLatBoundary = 40.517692;
  const southLatBoundary = 39.084296;
  const westLongBoundary = -107.399081;
  const eastLongBoundary = -105.128684;

  if (!closure || !closure.Location) {
    return false;
  }

  const { Latitude, Longitude } = closure.Location;
  const lat = parseFloat(Latitude);
  const long = parseFloat(Longitude);

  const inLatBounds = lat >= southLatBoundary && lat <= northLatBoundary;
  const inLongBounds = long >= westLongBoundary && long <= eastLongBoundary;

  return inLatBounds && inLongBounds;
}

async function checkTrafficClosures() {
  return B.all([readJSONFile(), getTrafficData()])
    .then(async ([savedClosures, updatedStateClosures]) => {
      const updatedClosures = updatedStateClosures.filter(filterOpenings);

      if (!savedClosures) {
        console.log(`Generating new ${roadDataFileName} file.`);
        return writeToJSONFile(updatedClosures);
      }

      const savedClosureAlertIds = savedClosures.map(
        (c: AlertObject) => c.AlertId
      );
      const updatedClosureAlertIds = updatedClosures.map(
        (c: AlertObject) => c.AlertId
      );

      const newClosures = updatedClosures.filter((closure: AlertObject) => {
        return !savedClosureAlertIds.includes(closure.AlertId);
      });

      const newOpenings = savedClosures.filter((closure: AlertObject) => {
        return !updatedClosureAlertIds.includes(closure.AlertId);
      });

      const timeStamp = new Date().toISOString();

      let updates = [];

      if (newClosures) {
        updates = newClosures.map((c) => {
          const directionText =
            c.IsBothDirectionFlg === "true"
              ? "in both directions"
              : `going ${c.Direction}`;
          const mileMarkerText = c.EndMileMarker
            ? `from mile marker ${c.StartMileMarker} to ${c.EndMileMarker}`
            : `at mile marker ${c.StartMileMarker}`;
          const severity = c.RoadwayClosureId === "4" ? "(full)" : "(partial)";
          const locationDescription = ` (${c.LocationDescription})` || "";

          const textMessage = `New ${severity} closure on ${c.RoadName} ${directionText} ${mileMarkerText}${locationDescription}. From CODOT: ${c.Description}`;
          console.log(`${timeStamp}: ${textMessage}`);
          return textMessage;
        });
      }

      if (newOpenings) {
        updates = [
          ...updates,
          ...newOpenings.map((c) => {
            const directionText =
              c.IsBothDirectionFlg === "true"
                ? "in both directions"
                : `going ${c.Direction}`;
            const mileMarkerText = c.EndMileMarker
              ? `from mile marker ${c.StartMileMarker} to ${c.EndMileMarker}`
              : `at mile marker ${c.StartMileMarker}`;
            const locationDescription = ` (${c.LocationDescription})` || "";

            const textMessage = `Road reopened on ${c.RoadName} ${directionText} ${mileMarkerText}${locationDescription}.`;
            console.log(`${timeStamp}: ${textMessage}`);
            return textMessage;
          }),
        ];
      }

      const changePresent =
        (newOpenings && newOpenings.length !== 0) ||
        (newClosures && newClosures.length !== 0);

      if (!changePresent) {
        console.log(`${timeStamp}: No new closures or openings`);
        return writeToJSONFile(updatedClosures);
      }

      const subscriptions = await readSubscriptionsFile();
      const validSubs = subscriptions.filter((sub) =>
        isFuture(new Date(sub.expiration))
      );

      await writeToNumbersFile(validSubs);
      await sendMessages(updates, validSubs);

      return writeToJSONFile(updatedClosures, savedClosures);
    })
    .catch((err) => {
      console.error("Encountered error fetching new data");
      console.error(err);
    });
}

async function startJob() {
  console.log("starting job");

  try {
    await fs.promises.mkdir(archiveDirectory);
    console.log("created archive directory");
  } catch (err) {
    console.log("archive directory already exists");
  }

  const cronPattern = "*/3 * * * *";
  const job = new Cron.CronJob(
    cronPattern,
    function () {
      return checkTrafficClosures();
    },
    null,
    true
  );

  console.log("job started with cron pattern", cronPattern);
}

startJob();
