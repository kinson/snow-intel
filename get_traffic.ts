import Axios from 'axios';
import * as B from 'bluebird';
import * as Cron from 'cron';

const readFileAsync: (name: string, encoding: string) => Promise<any> = B.promisify(require("fs").readFile);
const writeFileAsync: (name: string, contents: string, encoding: string) => Promise<any> = B.promisify(require("fs").writeFile)

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
  Location: Location
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
  const closuresData = await Axios.get<AlertsResponse>('https://www.cotrip.org/roadConditions/getLaneClosureAlerts.do');
  return closuresData.data.Alerts.Alert;
}

const fileName = './roaddata.json';


function readJSONFile(): Promise<AlertObject[] | null> {
  return readFileAsync(fileName, 'utf8').then(JSON.parse)
  .catch(() => {
    return null;
  });
}

function writeToJSONFile(updatedClosures: AlertObject[]): Promise<any> {
  return writeFileAsync(fileName, JSON.stringify(updatedClosures), 'utf8');
}

function checkTrafficClosures() {
  return B.all([readJSONFile(), getTrafficData()])
    .then(([savedClosures, updatedClosures]) => {
      if (!savedClosures) {
        console.log(`Generating new ${fileName} file.`)
        return writeToJSONFile(updatedClosures);
      }

      const savedClosureAlertIds = savedClosures.map((c: AlertObject) => c.AlertId);
      const updatedClosureAlertIds = updatedClosures.map((c: AlertObject) => c.AlertId);

      const newClosures = updatedClosures.filter((closure: AlertObject) => {
        return !savedClosureAlertIds.includes(closure.AlertId);
      });

      const newOpenings = savedClosures.filter((closure: AlertObject) => {
        return !updatedClosureAlertIds.includes(closure.AlertId);
      });

      const timeStamp = (new Date()).toISOString();

      if (newClosures) {
        newClosures.forEach((c) => {
          const directionText = c.IsBothDirectionFlg === 'true' ? 'in both directions' : `going ${c.Direction}`;
          const mileMarkerText = c.EndMileMarker ? `from mile marker ${c.StartMileMarker} to ${c.EndMileMarker}` : `at mile marker ${c.StartMileMarker}`;
          console.log(`${timeStamp}: New closure on ${c.RoadName} ${directionText} ${mileMarkerText}. From CODOT: ${c.Description}`);
        })
      }

      if (newOpenings) {
        newOpenings.forEach((c) => {
          const directionText = c.IsBothDirectionFlg === 'true' ? 'in both directions' : `going ${c.Direction}`;
          const mileMarkerText = c.EndMileMarker ? `from mile marker ${c.StartMileMarker} to ${c.EndMileMarker}` : `at mile marker ${c.StartMileMarker}`;
          console.log(`${timeStamp}: Road reopened on ${c.RoadName} ${directionText} ${mileMarkerText}.`);
        });
      }

      if ((!newOpenings || newOpenings.length === 0) && (!newClosures || newClosures.length === 0)) {
        console.log(`${timeStamp}: No new closures or openings`);
      }

      return writeToJSONFile(updatedClosures);
    }).catch((err) => {
      console.error('Encountered error fetching new data');
      console.error(err);
    })
}

var job = new Cron.CronJob(
	'*/2 * * * *',
	function() {
		return checkTrafficClosures();
	},
	null,
	true
);