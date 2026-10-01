# AWS picture style

The `aws` profile follows the look of AWS's own architecture diagrams (measured from the official icon deck, light background). The script already applies the values below; this page tells you what to expect and what to check in the picture.

## What the profile does for you

| Element | Rule |
|---|---|
| Labels | Liberation Sans (metric-compatible with Arial), 12 pt black, centred under icons, at most two lines |
| Icons | predefined sizes, never recoloured, cropped, flipped or stretched: service 80 px, resource and general 48 px, group corner icon 40 px |
| Lines | 1.25 pt black, right angles, small open arrowheads; dashed for secondary flows |
| Step badges | black circle with a bold white number, in front of the edge label |
| Group boxes | sharp corners, no fill, 1.25 pt, colour and dash by type (below), corner icon with the label to its right |
| Background | white, 24 px margin, PNG at 2x or more |

| Group type | Colour | Dash | Corner icon |
|---|---|---|---|
| AWS Cloud | #232F3E | solid | AWS logo |
| Region | #00A4A6 | fine dashes | Region flag |
| Availability Zone | #00A4A6 | dashes | none, centred label |
| VPC | #8C4FFF | solid | VPC |
| Public subnet | #7AA116 | solid | padlock (green) |
| Private subnet | #00A4A6 | solid | padlock (teal) |
| AWS account | #E7157B | solid | account |
| Corporate data center | #7D8998 | solid | building |
| Security group | #DD344C | solid | none |
| Auto Scaling group | #ED7100 | dashes | Auto Scaling |
| Generic / Generic solid | #7D8998 | dashes / solid | none |

## What you decide, and where pictures go wrong

- **Right icon.** Use the official service name. Resource icons exist for things like Application Load Balancer, internet gateway, NAT gateway and S3 bucket ("Amazon S3 (bucket)"); everything else is a service icon. For people and generic items use the General icons: Users, User, Client, Mobile client, Server, Servers, Internet, Email, Database, Document, Firewall, Globe, Logs, Metrics, Git Repository, Office building, Gear. If AWS has no icon, use `"icon": "box"`; never a guessed one.
- **Right nesting.** AWS Cloud > Region > VPC > Availability Zone > subnet. Accounts surround or sit beside clouds. Users, the internet and on-premises sit outside the AWS Cloud. Global services (Route 53, CloudFront, IAM) sit outside the Region box; regional services (S3, DynamoDB, Lambda without VPC attachment) sit in the Region but outside the VPC. NAT gateways and load balancers belong in public subnets, application and database tiers in private subnets.
- **One flow direction**, left to right. Number the steps 1..n along the main path. Use dashed lines for logs, metrics, replication and other secondary flows, dotted lines without arrowhead for associations (for example WAF to CloudFront).
- **Official names** in labels, kept short: "Amazon CloudFront", "AWS Lambda", "Application Load Balancer". Region and zone names go in the group label ("Region eu-west-1", "Availability Zone A").
- **Legible size.** Aim for text of at least 12 px at the width the picture is pasted. Wide pictures: split them.

## Check list for the finished picture

1. White background, nothing clipped, group titles and labels fully visible and not crossed by lines.
2. Every service has the correct official icon; tile colours match the service category.
3. Group colours and dashes as in the table; nesting correct; no big empty areas.
4. Lines orthogonal, attached to icon centre lines, not running through icons or labels, few crossings.
5. Step numbers black, in order, next to their own line, not covering icons.
6. All labels present and readable (a missing font would make text vanish; `--doctor` checks the font).
7. Aspect ratio between about 1:2 and 3:1.

## Usage rules for the icons

AWS lets customers and partners use the icons to create architecture diagrams, and asks that icons are used at their predefined size and colour, not cropped, flipped, rotated or reshaped. It states no right to redistribute the icon files, so the pack is imported per user and never added to a repository. This is not legal advice.
