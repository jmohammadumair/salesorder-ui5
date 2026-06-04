const fs = require('fs');
const content = fs.readFileSync('webapp/localService/metadata.xml', 'utf8');
const regex = /<EntityType Name="A_SalesOrderPartnerSimulationType"(.*?)<\/EntityType>/s;
const match = content.match(regex);
if (match) {
    const props = [...match[0].matchAll(/<Property Name="(.*?)"/g)];
    console.log(props.map(p => p[1]).join('\n'));
} else {
    console.log('Not found');
}

